import * as path from 'path';
import * as requests from './requests';
import * as simpleGit from 'simple-git';
import * as vscode from 'vscode';

import * as types from './types';

/** Generic class for providing tree views */
export class SemaphoreTreeProvider {
    constructor(public readonly projects: types.Project[]) { };

    // The branch selected for getting the branch tree view. When `null`, the current checked out
    // branch is chosen.
    public selectedBranch: { [workspaceName: string]: string | null } = {};
    /** Holds the tree of items. This variable is populated by `this.buildBranchTree()` */
    protected tree: WorkspaceDirectoryTreeItem[] | null = null;
    public treeview: vscode.TreeView<SemaphoreTreeItem> | null = null;
    protected expandedPipelines: Set<string> = new Set();
    protected _onDidChangeTreeData:
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
    protected isRefreshing: boolean = true;

    getTreeItem(element: SemaphoreTreeItem): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return element;
    }

    /** Gathers the data for the tree view and populates `this.tree` */
    async buildTree() { };

    /** Keep track of expanded and collapsed pipelines to optimize loading
     *
     * NOTE: this event does NOT always get called. Notably it doesn't when the tree view is
     * refreshing.
    */
    public onExpandElement(event: vscode.TreeViewExpansionEvent<SemaphoreTreeItem>) {
        if (event.element instanceof PipelineTreeItem) {
            const pipelineId = event.element.pipeline.ppl_id;
            if (!this.expandedPipelines.has(pipelineId)) {
                this.expandedPipelines.add(pipelineId);
                this.buildTree().then(() => this._onDidChangeTreeData.fire());
            }
        }
    }

    /** Keep track of expanded and collapsed pipelines to optimize loading.
     *
     * NOTE: this event does NOT always get called. Notably it doesn't when the tree view is
     * refreshing.
    */
    public onCollapseElement(event: vscode.TreeViewExpansionEvent<SemaphoreTreeItem>) {
        if (event.element instanceof PipelineTreeItem) {
            this.expandedPipelines.delete(event.element.pipeline.ppl_id);
        }
    }

    /**  Refresh immediately. Any ongoing refresh will be canceled
    */
    async refreshNow() {
        await this.buildTree();
        this._onDidChangeTreeData.fire();
    }

    /**  Refresh if not already refreshing. If a refresh is ongoing, that will finish instead
    */
    async refreshIfIdle() {
        if (!this.isRefreshing) {
            await this.buildTree();
            this._onDidChangeTreeData.fire();
        }
    }

    async getWorkspaceFolders(): Promise<WorkspaceDirectoryTreeItem[]> {
        let workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return [];
        }
        let res: WorkspaceDirectoryTreeItem[] = [];

        for (const workspaceFolder of workspaceFolders) {
            const gitRepo = simpleGit.default(workspaceFolder.uri.fsPath);
            const branch = await gitRepo.branchLocal();
            const selectedBranch: string | null | undefined = this.selectedBranch[workspaceFolder.name];
            const branchname =
                selectedBranch ? selectedBranch :
                    branch.detached ? "" : branch.current;
            res.push(new WorkspaceDirectoryTreeItem(workspaceFolder, gitRepo, branchname, this));
        }

        return res;
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
export class SemaphoreTreeItem extends vscode.TreeItem {
}

export class WorkspaceDirectoryTreeItem extends SemaphoreTreeItem {
    public children: SemaphoreTreeItem[] = [];

    constructor(
        public readonly workspaceFolder: vscode.WorkspaceFolder,
        public readonly gitRepo: simpleGit.SimpleGit,
        public readonly branch: string,
        public readonly provider: SemaphoreTreeProvider) {
        super(workspaceFolder.name, vscode.TreeItemCollapsibleState.Expanded);

        this.description = branch;
        this.contextValue = "semaphoreWorkspaceDirectory";
    }
}

/** Shown when no suitable project is found for a workspace */
export class NoSuitableProjectTreeItem extends SemaphoreTreeItem {
    constructor() {
        super("No suitable Semaphore project found", vscode.TreeItemCollapsibleState.None);
    }
}

export class PipelineTreeItem extends SemaphoreTreeItem {
    public children: SemaphoreTreeItem[] = [];

    constructor(
        public readonly project: types.Project,
        public readonly pipeline: types.Pipeline
    ) {
        const formatted = types.formatTime(pipeline.created_at.seconds);

        super(formatted, vscode.TreeItemCollapsibleState.Collapsed);

        const commitMsgBeforeNewline = pipeline.commit_message.match('[^\n]*');
        this.description =
            commitMsgBeforeNewline !== null ? commitMsgBeforeNewline[0] : pipeline.commit_message;
        this.iconPath = stateAndResultToIcon(pipeline.state, pipeline.result);
        this.contextValue = "semaphorePipeline";
    }
}

/** When a block has no jobs, show the status of the block */
export class BlockTreeItem extends SemaphoreTreeItem {
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

        switch (job.status) {
            case types.JobStatus.finished: {
                this.contextValue = "semaphoreJob";
                break;
            }
            default: {
                this.contextValue = "semaphoreJobRunning";
            }
        }
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
        case types.JobStatus.enqueued: {
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
        case types.PipelineState.pending: {
            iconName = "pending.svg";
            break;
        }
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
