import * as path from 'path';
import * as vscode from 'vscode';
import * as simpleGit from 'simple-git';

import * as apiKey from './semaphore/apiKey';
import * as types from './semaphore/types';
import * as requests from './semaphore/requests';
import * as jobLogRender from './semaphore/jobLogRender';

// this method is called when the extension is activated, i.e. when the view is opened
export function activate(context: vscode.ExtensionContext) {
	let treeProvider: SemaphoreBranchProvider | undefined;

	createTreeDataProvider().then(provider => { treeProvider = provider; });

	// Get the API key to register that it is set. For now, nothing needs to be done with the key
	// itself. This will make sure that the right welcome screens are shown at the right time. The
	// semaphore-ci.initialized is set to indicate that it is known whether the API key is set.
	// Without this, the "Set API Key" welcome screen would flash on startup, even if the API key is
	// set.
	apiKey.getApiKey().then(() =>
		vscode.commands.executeCommand('setContext', 'semaphore-ci.initialized', true)
	);

	vscode.commands.registerCommand('semaphore-ci.openLogs', openJobLogs);

	vscode.commands.registerCommand('semaphore-ci.refreshTree', () => {
		if (!treeProvider) {
			createTreeDataProvider().then(provider => { treeProvider = provider; });
			return;
		}

		treeProvider.refresh();
	});

	let disposable = vscode.commands.registerCommand('semaphore-ci.setApiKey', async () => {
		const apiKeyQuery = await vscode.window.showInputBox({
			placeHolder: "API Key",
			prompt: "Semaphore CI API key. Get from https://me.semaphoreci.com/account",
		});

		apiKey.setApiKey(apiKeyQuery);
		createTreeDataProvider();
	});
	context.subscriptions.push(disposable);

	disposable = vscode.workspace.registerTextDocumentContentProvider(
		"semaphore-ci-joblog",
		new JobLogProvider()
	);
	context.subscriptions.push(disposable);
}

/** this method is called when the extension is deactivated */
export function deactivate() { }

async function createTreeDataProvider(): Promise<SemaphoreBranchProvider | undefined> {
	const organisations: string[] = vscode.workspace.getConfiguration("semaphore-ci").organisations;
	if (organisations.length === 0) {
		return;
	}

	// Don't start requesting things if the API key is not set.
	const apiKeySet = await apiKey.isApiKeySet();
	if (!apiKeySet) {
		return;
	}

	const projects = await requests.getProjects(organisations);
	const treeProvider = new SemaphoreBranchProvider(projects);

	vscode.window.registerTreeDataProvider(
		"semaphore-ci-current-branch",
		treeProvider
	);

	return treeProvider;
}

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
		// Top level: List workspace folders and their branch
		if (!element) {
			return this.getWorkspaceFolders();
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
		this.iconPath = blockToIcon(block);
	}
}

/** When a block has jobs, show the status of each individual job instead of the
 * entire block */
class JobTreeItem extends SemaphoreTreeItem {
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

	return {
		light: path.join(__filename, '..', '..', 'resources', 'light', iconName),
		dark: path.join(__filename, '..', '..', 'resources', 'dark', iconName)
	};
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
			};
		}
	}
	if (!iconName) {
		vscode.window.showErrorMessage(
			`Could not generate job icon for job state ${job.status}/${job.result}`
		);
		iconName = "pending.svg";
	}

	return {
		light: path.join(__filename, '..', '..', 'resources', 'light', iconName),
		dark: path.join(__filename, '..', '..', 'resources', 'dark', iconName)
	};
}

async function openJobLogs(jobElement: JobTreeItem) {
	const organisation = jobElement.parent.project.spec.repository.owner;
	const uri = vscode.Uri.parse(
		`semaphore-ci-joblog:${organisation}/${jobElement.job.job_id}/${jobElement.job.name}.md`
	);
	const doc = await vscode.workspace.openTextDocument(uri);
	await vscode.window.showTextDocument(doc, { preview: false });
}

class JobLogProvider implements vscode.TextDocumentContentProvider {
	constructor() { }

	provideTextDocumentContent(uri: vscode.Uri, _token: vscode.CancellationToken): vscode.ProviderResult<string> {
		const pathElements = uri.path.split('/');
		const organisation = pathElements[0];
		const jobId = pathElements[1];
		return requests.getJobLogs(organisation, jobId).then(jobLog => {
			return jobLogRender.renderJobLog(jobLog);
		});
	}
}
