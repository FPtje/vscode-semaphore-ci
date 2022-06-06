import * as path from 'path';
import * as vscode from 'vscode';

import * as types from './semaphore/types';
import * as requests from './semaphore/requests';
import * as simpleGit from 'simple-git';

// this method is called when the extension is activated, i.e. when the view is opened
export function activate(context: vscode.ExtensionContext) {
	requests.getProjects().then(function (projects: types.Project[]) {
		const treeProvider = new SemaphoreBranchProvider(projects);

		let disposable = vscode.window.registerTreeDataProvider(
			"semaphore-ci-current-branch",
			treeProvider
		);

		vscode.commands.registerCommand('semaphore-ci.refreshTree', () =>
			treeProvider.refresh()
		);

		context.subscriptions.push(disposable);
	});
}

/** this method is called when the extension is deactivated */
export function deactivate() { }

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

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	getChildren(element?: SemaphoreTreeItem): vscode.ProviderResult<SemaphoreTreeItem[]> {
		// Top level: List workspaces
		if (!element) {
			let workspaceFolders = vscode.workspace.workspaceFolders;
			if (!workspaceFolders || workspaceFolders.length === 0) {
				return [];
			}
			let res: SemaphoreTreeItem[] = [];

			workspaceFolders.forEach(workspaceFolder => {
				res.push(new WorkspaceDirectoryTreeItem(workspaceFolder));
			});

			return res;
		}

		// Second level: List pipelines
		if (element instanceof WorkspaceDirectoryTreeItem) {
			return this.getPipelines(element);
		}

		// Third level: Pipeline details
		if (element instanceof PipelineTreeItem) {
			return this.getPipelineDetails(element);
		}

		return [];
	}

	getTreeItem(element: SemaphoreTreeItem): vscode.TreeItem | Thenable<vscode.TreeItem> {
		return element;
	}

	async getPipelines(element: WorkspaceDirectoryTreeItem): Promise<SemaphoreTreeItem[]> {
		const project = await this.getProjectOfWorkspaceFolder(element);

		if (!project) {
			return [new NoSuitableProjectTreeItem()];
		}
		const organisation = project.spec.repository.owner;
		const projectId = project.metadata.id;

		const branch = await element.gitRepo.branchLocal();

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
				treeItems.push(new JobTreeItem(block, job));
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

				if (remoteUrl.includes(owner) && remoteUrl.includes(name)) {
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
	readonly gitRepo: simpleGit.SimpleGit;

	constructor(public readonly workspaceFolder: vscode.WorkspaceFolder) {
		super(workspaceFolder.name, vscode.TreeItemCollapsibleState.Expanded);

		this.gitRepo = simpleGit.default(workspaceFolder.uri.fsPath);
	}
}

/** Shown when no suitable project is found for  */
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
		const timestamp = new Date(pipeline.created_at.seconds * 1000);

		const months = (timestamp.getMonth() + 1).toString().padStart(2, "0");
		const days = (timestamp.getDay() + 1).toString().padStart(2, "0");
		const hour = (timestamp.getHours()).toString().padStart(2, "0");
		const minute = (timestamp.getMinutes()).toString().padStart(2, "0");
		const formatted = `${timestamp.getFullYear()}-${months}-${days} ${hour}:${minute}`;

		super(formatted, vscode.TreeItemCollapsibleState.Collapsed);

		this.description = pipeline.commit_message;
		this.iconPath = stateAndResultToIcon(pipeline.state, pipeline.result);
	}
}

/** When a block has no jobs, show the status of the block */
class BlockTreeItem extends SemaphoreTreeItem {
	constructor(public readonly block: types.Block) {
		super(block.name, vscode.TreeItemCollapsibleState.None);
		const pipelineState = types.BlockStateToPipelineState(block.state);
		const pipelineResult = types.BlockResultToPipelineResult(block.result);
		this.iconPath = stateAndResultToIcon(pipelineState, pipelineResult);
	}
}

/** When a block has jobs, show the status of each individual job instead of the
 * entire block */
class JobTreeItem extends SemaphoreTreeItem {
	constructor(public readonly block: types.Block, public readonly job: types.Job) {
		super(job.name, vscode.TreeItemCollapsibleState.None);
		this.description = block.name;
		this.iconPath = jobToIcon(job);
	}
}

/** Pipeline status icon from state and result */
function stateAndResultToIcon(
	state: types.PipelineState,
	result: types.PipelineResult | undefined): { light: string; dark: string; } {
	let iconName: string;

	switch (state) {
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

	return {
		light: path.join(__filename, '..', '..', 'resources', 'light', iconName),
		dark: path.join(__filename, '..', '..', 'resources', 'dark', iconName)
	};
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
			}
			break;
		}
	}

	return {
		light: path.join(__filename, '..', '..', 'resources', 'light', iconName),
		dark: path.join(__filename, '..', '..', 'resources', 'dark', iconName)
	};
}
