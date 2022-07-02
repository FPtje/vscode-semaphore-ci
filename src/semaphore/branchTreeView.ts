import * as path from 'path';
import * as simpleGit from 'simple-git';
import * as vscode from 'vscode';

import * as requests from './requests';
import * as types from './types';

/**
 * The provider for the branch tree view. This class runs the requests to to semaphore and
 * translates them to tree view elements.
 */
export class SemaphoreBranchProvider implements vscode.TreeDataProvider<SemaphoreTreeItem> {
	constructor(public readonly projects: types.Project[]) { };

	private _onDidChangeTreeData:
		vscode.EventEmitter<
			SemaphoreTreeItem |
			SemaphoreTreeItem[] |
			undefined |
			null |
			void
		> = new vscode.EventEmitter<SemaphoreTreeItem |
			SemaphoreTreeItem[] |
			undefined |
			null |
			void
		>();

	onDidChangeTreeData?:
		vscode.Event<
			void |
			SemaphoreTreeItem |
			SemaphoreTreeItem[] |
			null |
			undefined
		> = this._onDidChangeTreeData.event;

	private isRefreshing: boolean = true;

	/**  Refresh immediately. Any ongoing refresh will be canceled
	*/
	refreshNow(): void {
		this._onDidChangeTreeData.fire();
	}

	/**  Refresh if not already refreshing. If a refresh is ongoing, that will finish instead
	*/
	refreshIfIdle(): void {
		if (!this.isRefreshing) {
			this._onDidChangeTreeData.fire();
		}
	}

	getChildren(element?: SemaphoreTreeItem): vscode.ProviderResult<SemaphoreTreeItem[]> {
		let providerResult;
		this.isRefreshing = true;

		// Top level: List workspace folders and their branch
		if (!element) {
			providerResult = this.getWorkspaceFolders();
		}

		// Second level: List pipelines
		if (element instanceof WorkspaceDirectoryTreeItem) {
			providerResult = this.getPipelines(element);
		}

		// Third level: Pipeline details
		if (element instanceof PipelineTreeItem) {
			providerResult = this.getPipelineDetails(element);
		}

		if (!providerResult) {
			this.isRefreshing = false;
			return [];
		}

		return Promise.resolve(providerResult).then((result) => {
			this.isRefreshing = false;
			return result;
		});
	}

	getTreeItem(element: SemaphoreTreeItem): vscode.TreeItem | Thenable<vscode.TreeItem> {
		return element;
	}

	async getWorkspaceFolders(): Promise<SemaphoreTreeItem[]> {
		let workspaceFolders = vscode.workspace.workspaceFolders;
		if (!workspaceFolders || workspaceFolders.length === 0) {
			return [];
		}
		let res: SemaphoreTreeItem[] = [];

		for (const workspaceFolder of workspaceFolders) {
			const gitRepo = simpleGit.default(workspaceFolder.uri.fsPath);
			const branch = await gitRepo.branchLocal();
			res.push(new WorkspaceDirectoryTreeItem(workspaceFolder, gitRepo, branch));
		}

		return res;
	}

	async getPipelines(element: WorkspaceDirectoryTreeItem): Promise<SemaphoreTreeItem[]> {
		const project = await this.getProjectOfWorkspaceFolder(element);

		if (!project) {
			return [new NoSuitableProjectTreeItem()];
		}
		const organisation = project.spec.repository.owner;
		const projectId = project.metadata.id;

		const branch = element.branch;

		if (branch.detached) { return []; }

		const pipelines = await requests.getPipelines(organisation, projectId, branch.current);

		return pipelines.map((pipeline) => new PipelineTreeItem(project, pipeline));
	}

	async getPipelineDetails(element: PipelineTreeItem): Promise<SemaphoreTreeItem[]> {
		const organisation = element.project.spec.repository.owner;

		const pipelineDetails =
			await requests.getPipelineDetails(organisation, element.pipeline.ppl_id);

		let treeItems: SemaphoreTreeItem[] = [];
		for (let block of pipelineDetails.blocks) {
			if (block.jobs.length === 0) {
				treeItems.push(new BlockTreeItem(block));
				continue;
			}

			for (let job of block.jobs) {
				treeItems.push(new JobTreeItem(element, block, job));
			}
		}
		return treeItems;
	}

	/** Get the Semaphore project belonging to a workspace folder. It looks at
	 * the remotes and tries to match them against a project. It returns the
	 * first project that matches a remote.
	*/
	async getProjectOfWorkspaceFolder(element: WorkspaceDirectoryTreeItem):
		Promise<types.Project | null> {
		const isRepo = await element.gitRepo.checkIsRepo();

		if (!isRepo) { return Promise.resolve(null); }

		const remotes = await element.gitRepo.getRemotes(true);

		for (let remote of remotes) {
			const remoteUrl = remote.refs.fetch.toLowerCase();

			for (let project of this.projects) {
				const owner = project.spec.repository.owner.toLowerCase();
				const name = project.spec.repository.name.toLowerCase();

				if (remoteUrl.includes(`${owner}/${name}`)) {
					return project;
				}
			};
		}

		return Promise.resolve(null);
	}
}

/**
 *  Generic class for everything that's put in the tree view.
*/
class SemaphoreTreeItem extends vscode.TreeItem {
}

class WorkspaceDirectoryTreeItem extends SemaphoreTreeItem {
	constructor(
		public readonly workspaceFolder: vscode.WorkspaceFolder,
		public readonly gitRepo: simpleGit.SimpleGit,
		public readonly branch: simpleGit.BranchSummary) {
		super(workspaceFolder.name, vscode.TreeItemCollapsibleState.Expanded);

		if (!branch.detached) {
			this.description = branch.current;
		}
	}
}

/** Shown when no suitable project is found for a workspace */
class NoSuitableProjectTreeItem extends SemaphoreTreeItem {
	constructor() {
		super("No suitable Semaphore project found", vscode.TreeItemCollapsibleState.None);
	}
}

class PipelineTreeItem extends SemaphoreTreeItem {
	constructor(
		public readonly project: types.Project,
		public readonly pipeline: types.Pipeline
	) {
		const formatted = types.formatTime(pipeline.created_at.seconds);

		super(formatted, vscode.TreeItemCollapsibleState.Collapsed);

		this.description = pipeline.commit_message;
		this.iconPath = stateAndResultToIcon(pipeline.state, pipeline.result);
	}
}

/** When a block has no jobs, show the status of the block */
class BlockTreeItem extends SemaphoreTreeItem {
	constructor(public readonly block: types.Block) {
		super(block.name, vscode.TreeItemCollapsibleState.None);
		this.iconPath = blockToIcon(block);
	}
}

/** When a block has jobs, show the status of each individual job instead of the
 * entire block */
export class JobTreeItem extends SemaphoreTreeItem {
	constructor(
		public readonly parent: PipelineTreeItem,
		public readonly block: types.Block,
		public readonly job: types.Job
	) {
		super(job.name, vscode.TreeItemCollapsibleState.None);
		this.description = block.name;
		this.iconPath = jobToIcon(job);
		this.contextValue = "semaphoreJob";
	}
}

/** Job status/result to icon */
function jobToIcon(job: types.Job): { light: string; dark: string; } {
	let iconName: string;

	switch (job.status) {
		case types.JobStatus.pending: {
			iconName = "pending.svg";
			break;
		}
		case types.JobStatus.queued: {
			iconName = "queued.svg";
			break;
		}
		case types.JobStatus.running: {
			iconName = "running.svg";
			break;
		}
		case types.JobStatus.finished: {
			switch (job.result) {
				case types.JobResult.passed: {
					iconName = "status-ok.svg";
					break;
				}
				case types.JobResult.failed: {
					iconName = "status-error.svg";
					break;
				}
				case types.JobResult.stopped: {
					iconName = "status-stopped.svg";
					break;
				}
			};
		}
	}
	if (!iconName) {
		vscode.window.showErrorMessage(
			`Could not generate job icon for job state ${job.status}/${job.result}`
		);
		iconName = "pending.svg";
	}

	return resource(iconName);
}

/** Use the block state and status to produce an icon */
function blockToIcon(
	block: types.Block): { light: string; dark: string; } {
	let iconName: string;

	switch (block.state) {
		case types.BlockState.waiting: {
			iconName = "queued.svg";
			break;
		}
		case types.BlockState.running: {
			iconName = "running.svg";
			break;
		}
		case types.BlockState.stopping: {
			iconName = "stopping.svg";
			break;
		}
		case types.BlockState.done: {
			if (!block.result) {
				iconName = "status-error.svg";
				break;
			}

			switch (block.result) {
				case types.BlockResult.passed: {
					iconName = "status-ok.svg";
					break;
				}
				case types.BlockResult.stopped: {
					iconName = "status-stopped.svg";
					break;
				}
				case types.BlockResult.canceled: {
					// TODO: Canceled icon?
					iconName = "status-stopped.svg";
					break;
				}
				case types.BlockResult.failed: {
					iconName = "status-error.svg";
					break;
				}
			}
			break;
		}
	}

	if (!iconName) {
		vscode.window.showErrorMessage(
			`Could not generate block icon for block state ${block.state}/${block.result}`
		);
		iconName = "pending.svg";
	}

	return resource(iconName);
}

/** Pipeline status icon from state and result */
function stateAndResultToIcon(
	state: types.PipelineState,
	result: types.PipelineResult | undefined): { light: string; dark: string; } {
	let iconName: string;

	switch (state) {
		case types.PipelineState.queuing: {
			iconName = "queued.svg";
			break;
		}
		case types.PipelineState.initializing: {
			iconName = "queued.svg";
			break;
		}
		case types.PipelineState.running: {
			iconName = "running.svg";
			break;
		}
		case types.PipelineState.stopping: {
			iconName = "stopping.svg";
			break;
		}
		case types.PipelineState.done: {
			if (!result) {
				iconName = "status-error.svg";
				break;
			}

			switch (result) {
				case types.PipelineResult.passed: {
					iconName = "status-ok.svg";
					break;
				}
				case types.PipelineResult.stopped: {
					iconName = "status-stopped.svg";
					break;
				}
				case types.PipelineResult.canceled: {
					// TODO: Canceled icon?
					iconName = "status-stopped.svg";
					break;
				}
				case types.PipelineResult.failed: {
					iconName = "status-error.svg";
					break;
				}
			}
			break;
		}
	}

	if (!iconName) {
		vscode.window.showErrorMessage(
			`Could not generate pipeline icon for pipeline state ${state}/${result}`
		);
		iconName = "pending.svg";
	}

	return resource(iconName);
}

/** Helper function to define an icon path */
function resource(iconName: string): { light: string; dark: string; } {
    return {
		light: path.join(__filename, '..', '..', '..', 'resources', 'light', iconName),
		dark: path.join(__filename, '..', '..', '..', 'resources', 'dark', iconName)
	};
}
