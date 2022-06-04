import * as vscode from 'vscode';

import * as types from './semaphore/types';
import * as requests from './semaphore/requests';
import * as simpleGit from 'simple-git';

// this method is called when the extension is activated, i.e. when the view is opened
export function activate(context: vscode.ExtensionContext) {
	requests.getProjects().then(function (projects: types.Project[]) {
		const treeProvider = new SemaphoreBranchProvider(projects);

		let disposable = vscode.window.registerTreeDataProvider("semaphore-ci-current-branch", treeProvider);

		context.subscriptions.push(disposable);
	});
}

/** this method is called when the extension is deactivated */
export function deactivate() { }

export class SemaphoreBranchProvider implements vscode.TreeDataProvider<SemaphoreTreeItem> {
	constructor(public readonly projects: types.Project[]) { };

	onDidChangeTreeData?: vscode.Event<void | SemaphoreTreeItem | SemaphoreTreeItem[] | null | undefined> | undefined;

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

		// Second level: List workflows/pipelines.
		if (element instanceof WorkspaceDirectoryTreeItem) {
			return this.getWorkflows(element);
		}

		return [];
	}

	getTreeItem(element: SemaphoreTreeItem): vscode.TreeItem | Thenable<vscode.TreeItem> {
		return element;
	}

	async getWorkflows(element: WorkspaceDirectoryTreeItem): Promise<SemaphoreTreeItem[]> {
		const project = await this.getProjectOfWorkspaceFolder(element);

		if (!project) {
			return [new NoSuitableProjectTreeItem()];
		}
		const organisation = project.spec.repository.owner;
		const projectId = project.metadata.id;

		const branch = await element.gitRepo.branchLocal();

		if (branch.detached) { return []; }

		const pipelines = await requests.getPipelines(organisation, projectId, branch.current);

		return pipelines.map((pipeline) => new PipelineTreeItem(pipeline));
	}

	/** Get the Semaphore project belonging to a workspace folder. It looks at
	 * the remotes and tries to match them against a project. It returns the
	 * first project that matches a remote.
	*/
	async getProjectOfWorkspaceFolder(element: WorkspaceDirectoryTreeItem): Promise<types.Project | null> {
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
	constructor(public readonly pipeline: types.Pipeline) {
		const timestamp = new Date(pipeline.created_at.seconds * 1000);

		const months = (timestamp.getMonth() + 1).toString().padStart(2, "0");
		const days = (timestamp.getDay() + 1).toString().padStart(2, "0");
		const hour = (timestamp.getHours()).toString().padStart(2, "0");
		const minute = (timestamp.getMinutes()).toString().padStart(2, "0");
		const formatted = `${timestamp.getFullYear()}-${months}-${days} ${hour}:${minute}`;

		super(formatted, vscode.TreeItemCollapsibleState.Collapsed);

		this.description = pipeline.commit_message;
	}
}
