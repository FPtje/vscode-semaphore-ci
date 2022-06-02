import * as vscode from 'vscode';
import axios from 'axios';

import * as types from './semaphore/types';
import * as requests from './semaphore/requests';

// this method is called when the extension is activated, i.e. when the view is opened
export function activate(context: vscode.ExtensionContext) {

	// Test code
	requests.getProjects().then(function(projects: types.Project[]) {
		console.log("RECEIVED PROJECTS!");
		console.log(projects);
	});


	let disposable = vscode.window.registerTreeDataProvider("semaphore-ci-current-branch", new SemaphoreBranchProvider());

	context.subscriptions.push(disposable);
}

// this method is called when the extension is deactivated
export function deactivate() { }

export class SemaphoreBranchProvider implements vscode.TreeDataProvider<TodoNameForTreeItem> {
	onDidChangeTreeData?: vscode.Event<void | TodoNameForTreeItem | TodoNameForTreeItem[] | null | undefined> | undefined;

	getTreeItem(element: TodoNameForTreeItem): vscode.TreeItem | Thenable<vscode.TreeItem> {
		return element;
	}
	getChildren(element?: TodoNameForTreeItem): vscode.ProviderResult<TodoNameForTreeItem[]> {
		if (!element) {
			return [new TodoNameForTreeItem("hello", vscode.TreeItemCollapsibleState.Expanded)];
		}
		return [];
	}

}

class TodoNameForTreeItem extends vscode.TreeItem {
	constructor(public readonly label: string, public readonly collapsibleState: vscode.TreeItemCollapsibleState) {
		super(label, collapsibleState);
		this.tooltip = "bananas";
		this.description = "oh yeah";
	}
}
