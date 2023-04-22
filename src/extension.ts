import * as simpleGit from 'simple-git';
import * as vscode from 'vscode';

import * as apiKey from './semaphore/apiKey';
import * as branchTreeView from './semaphore/branchTreeView';
import * as tagsTreeView from './semaphore/tagsTreeView';
import * as jobLogRender from './semaphore/jobLogRender';
import * as requests from './semaphore/requests';
import * as treeView from './semaphore/treeView';
import * as types from './semaphore/types';

// this method is called when the extension is activated, i.e. when the view is opened
export function activate(context: vscode.ExtensionContext) {
    let branchTreeProvider: branchTreeView.SemaphoreBranchProvider | undefined;
    let tagsTreeProvider: tagsTreeView.SemaphoreTagsProvider | undefined;

    createTreeDataProvider().then(provider => {
        branchTreeProvider = provider;

        if (provider) {
            refreshTreeLoop(provider);
        }
    });

    createTagsTreeDataProvider().then(provider => {
        tagsTreeProvider = provider;
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

    vscode.commands.registerCommand('semaphore-ci.pickBranch', pickBranch);
    vscode.commands.registerCommand('semaphore-ci.openLogs', openJobLogs);
    vscode.commands.registerCommand('semaphore-ci.rerunWorkflow', rerunWorkflow);
    vscode.commands.registerCommand('semaphore-ci.stopJob', stopJob);

    vscode.commands.registerCommand('semaphore-ci.refreshTree', () => {
        if (branchTreeProvider) {
            branchTreeProvider.refreshNow();
        }

        if (tagsTreeProvider) {
            tagsTreeProvider.refreshNow();
        }
    });

    vscode.commands.registerCommand('semaphore-ci.refreshBranchTree', () => {
        if (branchTreeProvider) {
            branchTreeProvider.refreshNow();
        }
    });
    vscode.commands.registerCommand('semaphore-ci.refreshTagsTree', () => {
        if (tagsTreeProvider) {
            tagsTreeProvider.refreshNow();
        }
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

    let treeView = vscode.window.createTreeView('semaphore-ci-current-branch', {
        treeDataProvider: treeProvider
    });

    treeProvider.treeview = treeView;

    treeView.onDidExpandElement(event => treeProvider.onExpandElement(event));
    treeView.onDidCollapseElement(event => treeProvider.onCollapseElement(event));

    return treeProvider;
}

async function createTagsTreeDataProvider(): Promise<tagsTreeView.SemaphoreTagsProvider | undefined> {
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
    const treeProvider = new tagsTreeView.SemaphoreTagsProvider(projects);

    let treeView = vscode.window.createTreeView('semaphore-ci-tags', {
        treeDataProvider: treeProvider
    });

    treeProvider.treeview = treeView;

    treeView.onDidExpandElement(event => treeProvider.onExpandElement(event));
    treeView.onDidCollapseElement(event => treeProvider.onCollapseElement(event));

    return treeProvider;
}

async function refreshTreeLoop(provider: treeView.SemaphoreTreeProvider) {
    while (true) {
        let delay: number = vscode?.workspace?.getConfiguration("semaphore-ci")?.autorefreshDelay;

        if (!delay) {
            // Check the setting again in 10 seconds
            await new Promise(f => setTimeout(f, 10000));
            continue;
        }

        if (delay > 0) {
            await new Promise(f => setTimeout(f, delay));
        }

        // Only refresh when the tree is not already refreshing. Otherwise this call would cancel
        // the existing refresh. If that happens every time, the refresh never actually finishes,
        // effectively causing it never to refresh at all.
        provider.refreshIfIdle();
    }
}

async function pickBranch(workspaceElement: treeView.WorkspaceDirectoryTreeItem) {
    const gitRepo = workspaceElement.gitRepo;

    let chosenBranch = await vscode.window.showQuickPick(getAvailableBranches(gitRepo), { canPickMany: false });

    // User canceled out of the dialog
    if (chosenBranch === undefined) { return; }

    let selection = chosenBranch === "Current branch" ? null : chosenBranch;
    const provider = workspaceElement.provider;

    provider.selectedBranch[workspaceElement.workspaceFolder.name] = selection;
    vscode.commands.executeCommand("semaphore-ci.refreshTree");
}

/**
 * Gets the available branches, both local and remote.
 * @returns List of available branches, plus a special value "Current branch".
 */
async function getAvailableBranches(gitRepo: simpleGit.SimpleGit): Promise<string[]> {
    let branches = await gitRepo.branch(["--all"]);
    console.log(branches);
    let allBranches = branches.all;

    // Remove the `remote/origin/` prefix from remote branches
    const rewriteRegex = /^remotes\/[^/]+\//;
    for (let i = 0; i < allBranches.length; i++) {
        allBranches[i] = allBranches[i].replace(rewriteRegex, "");
    }

    const uniqueBranches: Set<string> = new Set(allBranches);
    return ["Current branch", ...Array.from(uniqueBranches)];
}

async function openJobLogs(jobElement: treeView.JobTreeItem) {
    if (!jobElement) {
        console.warn("open job logs button pressed, but the element passed is undefined. This is a VS Code bug. Ignoring button press.");
        return;
    }

    const organisation = jobElement.parent.project.organisation;
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
    try{

        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, { preview: true });
    } catch (e: any) {
        vscode.window.showErrorMessage(`Failed to get job log for ${jobElement.job.name}. See the console for a detailed error message.`);
        console.error(e);
    }
}

async function stopJob(jobElement: treeView.JobTreeItem) {
    if (!jobElement) {
        console.warn("Stop job button pressed, but the element passed is undefined. This is a VS Code bug. Ignoring button press.");
        return;
    }

    const organisation = jobElement.parent.project.organisation;

    await requests.stopJob(organisation, jobElement.job.job_id);
    const buttonPressed = await vscode.window.showInformationMessage("Semaphore-ci: Stop job submitted", "refresh");
    if (buttonPressed) {
        vscode.commands.executeCommand("semaphore-ci.refreshTree");
    }
}

async function rerunWorkflow(pipelineElement: treeView.PipelineTreeItem) {
    if (!pipelineElement) {
        console.warn("Rerun pipeline button pressed, but the element passed is undefined. This is a VS Code bug. Ignoring button press.");
        return;
    }
    const organisation = pipelineElement.project.organisation;

    await requests.rerunWorkflow(organisation, pipelineElement.pipeline.wf_id);
    const buttonPressed = await vscode.window.showInformationMessage("Semaphore-ci: Rerun submitted", "refresh");
    if (buttonPressed) {
        vscode.commands.executeCommand("semaphore-ci.refreshTree");
    }
}

class JobLogProvider implements vscode.TextDocumentContentProvider {
    constructor() { }

    provideTextDocumentContent(uri: vscode.Uri, token: vscode.CancellationToken): vscode.ProviderResult<string> {
        const pathElements = uri.path.split('/');
        const organisation = pathElements[0];
        const jobId = pathElements[1];

        let promises: [Promise<types.JobDescription>, Promise<types.JobLog>] = [
            requests.getJobDescription(organisation, jobId),
            requests.getJobLogs(organisation, jobId),
        ];
        return Promise.all(promises).then(([description, logs]) => {
            if (token.isCancellationRequested) {
                return;
            }

            return jobLogRender.renderJobLog(organisation, description, logs);
        }).catch(err => {
            return `Unable to get job logs for job id ${jobId}. The following error was thrown: ${err}`;
        });
    }
}
