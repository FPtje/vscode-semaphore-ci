import * as vscode from 'vscode';

import * as types from './semaphore/types';
import * as requests from './semaphore/requests';

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
	constructor(public readonly projects: types.Project[]){	};

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

		// Second level: List workflows/pipelines. TODO
		if (element instanceof WorkspaceDirectoryTreeItem) {
		}

		return [];
	}

	getTreeItem(element: SemaphoreTreeItem): vscode.TreeItem | Thenable<vscode.TreeItem> {
		return element;
	}

	/** Get the Semaphore project belonging to a workspace folder */
	getProjectOfWorkspaceFolder(_workspaceFolder: vscode.WorkspaceFolder): types.Project | null {
		return null;
	}
}

/**
 *  Generic class for everything that's put in the tree view.
*/
class SemaphoreTreeItem extends vscode.TreeItem {
}

class WorkspaceDirectoryTreeItem extends SemaphoreTreeItem {
	constructor(public readonly workspaceFolder: vscode.WorkspaceFolder) {
		super(workspaceFolder.name, vscode.TreeItemCollapsibleState.Expanded);
	}
}
