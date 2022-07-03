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

    /** Holds the tree of items. This variable is populated by `this.buildBranchTree()` */
    private branchTree: WorkspaceDirectoryTreeItem[] | null = null;
    private expandedPipelines: Set<string> = new Set();
    public treeview: vscode.TreeView<SemaphoreTreeItem> | null = null;

	/**  Refresh immediately. Any ongoing refresh will be canceled
	*/
	async refreshNow() {
        await this.buildBranchTree();
		this._onDidChangeTreeData.fire();
	}

	/**  Refresh if not already refreshing. If a refresh is ongoing, that will finish instead
	*/
	async refreshIfIdle() {
		if (!this.isRefreshing) {
            await this.buildBranchTree();
			this._onDidChangeTreeData.fire();
		}
	}

    /** Gathers the data for the tree view and populates `this.branchTree` */
    async buildBranchTree() {
        this.isRefreshing = true;
        const workspaceFolders = await this.getWorkspaceFolders();

		// Workaround: Through treeview's onDidExpandElement and onDidCollapseElement events, we
		// keep track of which pipelines to get the details of. However, due to some race condition
		// with refreshing, those events do not always fire. This can lead to elements being
		// expanded without us knowing about it. With this we assume that a selected item is being
		// expanded. Details are always requested of selected pipelines.
        if (this.treeview) {
            for (const selected of this.treeview.selection) {
                if (selected instanceof PipelineTreeItem) {
                    this.expandedPipelines.add(selected.pipeline.ppl_id);
                }
            }
        }

        for (const workspaceFolder of workspaceFolders) {
            workspaceFolder.children = await this.getPipelines(workspaceFolder);

            let promises: Promise<any>[] = [];
            for (const pipelineTreeItem of workspaceFolder.children) {
                if (pipelineTreeItem instanceof NoSuitableProjectTreeItem) {
                    break;
                }

                if (pipelineTreeItem instanceof PipelineTreeItem) {
					const pipelineId = pipelineTreeItem.pipeline.ppl_id;
                    // Optimization: Do not load pipeline details if the item is not expanded in the
                    // tree view.
                    if (!this.expandedPipelines.has(pipelineId)) {
                        continue;
                    };

                    promises.push(this.getPipelineDetails(pipelineTreeItem).then(children => {
                        pipelineTreeItem.children = children;
                    }));
                }
            }
            await Promise.all(promises);
        }

        this.branchTree = workspaceFolders;
        this.isRefreshing = false;
    }

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
                this.buildBranchTree().then(() => this._onDidChangeTreeData.fire());
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

	getChildren(element?: SemaphoreTreeItem): vscode.ProviderResult<SemaphoreTreeItem[]> {
        if (!element && !this.branchTree) {
            // First population of the branch tree
            return this.buildBranchTree().then(() => this.getChildren(element));
        }

        if (!element) {
            return this.branchTree;
        }

        if (element instanceof WorkspaceDirectoryTreeItem) {
            return element.children;
        }

        if (element instanceof PipelineTreeItem) {
            return element.children;
        }

        return [];
	}

	getTreeItem(element: SemaphoreTreeItem): vscode.TreeItem | Thenable<vscode.TreeItem> {
		return element;
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
export class SemaphoreTreeItem extends vscode.TreeItem {
}

class WorkspaceDirectoryTreeItem extends SemaphoreTreeItem {
    public children: SemaphoreTreeItem[] = [];

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

export class PipelineTreeItem extends SemaphoreTreeItem {
    public children: SemaphoreTreeItem[] = [];

	constructor(
		public readonly project: types.Project,
		public readonly pipeline: types.Pipeline
	) {
		const formatted = types.formatTime(pipeline.created_at.seconds);

		super(formatted, vscode.TreeItemCollapsibleState.Collapsed);

		this.description = pipeline.commit_message;
		this.iconPath = stateAndResultToIcon(pipeline.state, pipeline.result);
		this.contextValue = "semaphorePipeline";
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
