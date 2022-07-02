import * as vscode from 'vscode';

import * as apiKey from './semaphore/apiKey';
import * as branchTreeView from './semaphore/branchTreeView';
import * as types from './semaphore/types';
import * as requests from './semaphore/requests';
import * as jobLogRender from './semaphore/jobLogRender';

// this method is called when the extension is activated, i.e. when the view is opened
export function activate(context: vscode.ExtensionContext) {
	let treeProvider: branchTreeView.SemaphoreBranchProvider | undefined;

	createTreeDataProvider().then(provider => {
		treeProvider = provider;

		if (provider) {
			refreshTreeLoop(provider);
		}
	});

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

		treeProvider.refreshNow();
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

async function createTreeDataProvider(): Promise<branchTreeView.SemaphoreBranchProvider | undefined> {
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
	const treeProvider = new branchTreeView.SemaphoreBranchProvider(projects);

	vscode.window.registerTreeDataProvider(
		"semaphore-ci-current-branch",
		treeProvider
	);

	return treeProvider;
}

async function refreshTreeLoop(provider: branchTreeView.SemaphoreBranchProvider) {
	while (true) {
		let delay: number = vscode?.workspace?.getConfiguration("semaphore-ci")?.autorefreshDelay;

		if(!delay) {
			// Check the setting again in 10 seconds
			await new Promise(f => setTimeout(f, 10000));
			continue;
		}

		if (delay > 0){
			await new Promise(f => setTimeout(f, delay));
		}

		// Only refresh when the tree is not already refreshing. Otherwise this call would cancel
		// the existing refresh. If that happens every time, the refresh never actually finishes,
		// effectively causing it never to refresh at all.
		provider.refreshIfIdle();
	}
}

async function openJobLogs(jobElement: branchTreeView.JobTreeItem) {
	const organisation = jobElement.parent.project.spec.repository.owner;
	let uriParameter = '';

	// If the job is still running, add a time parameter, to make sure that re-opening the document
	// re-runs the request. VS Code otherwise caches the document, even when closing it in the
	// workspace.
	if (jobElement.job.status !== types.JobStatus.finished) {
		uriParameter = `?time=${new Date().getTime()}`;
	}

	const uri = vscode.Uri.parse(
		`semaphore-ci-joblog:${organisation}/${jobElement.job.job_id}/${jobElement.job.name}.md${uriParameter}`
	);
	const doc = await vscode.workspace.openTextDocument(uri);
	await vscode.window.showTextDocument(doc, { preview: true  });
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
