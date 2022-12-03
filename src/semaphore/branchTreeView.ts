import * as requests from './requests';
import * as vscode from 'vscode';

import * as treeView from './treeView';

/**
 * The provider for the branch tree view. This class runs the requests to to semaphore and
 * translates them to tree view elements.
 */
export class SemaphoreBranchProvider extends treeView.SemaphoreTreeProvider implements vscode.TreeDataProvider<treeView.SemaphoreTreeItem> {
    async buildTree() {
        this.isRefreshing = true;
        const workspaceFolders = await this.getWorkspaceFolders();

        // Workaround: Through treeview's onDidExpandElement and onDidCollapseElement events, we
        // keep track of which pipelines to get the details of. However, due to some race condition
        // with refreshing, those events do not always fire. This can lead to elements being
        // expanded without us knowing about it. With this we assume that a selected item is being
        // expanded. Details are always requested of selected pipelines.
        if (this.treeview) {
            for (const selected of this.treeview.selection) {
                if (selected instanceof treeView.PipelineTreeItem) {
                    this.expandedPipelines.add(selected.pipeline.ppl_id);
                }
            }
        }

        for (const workspaceFolder of workspaceFolders) {
            workspaceFolder.children = await this.getPipelines(workspaceFolder);

            let promises: Promise<any>[] = [];
            for (const pipelineTreeItem of workspaceFolder.children) {
                if (pipelineTreeItem instanceof treeView.NoSuitableProjectTreeItem) {
                    break;
                }

                if (pipelineTreeItem instanceof treeView.PipelineTreeItem) {
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

        this.tree = workspaceFolders;
        this.isRefreshing = false;
    }

    getChildren(element?: treeView.SemaphoreTreeItem): vscode.ProviderResult<treeView.SemaphoreTreeItem[]> {
        if (!element && !this.tree) {
            // First population of the branch tree
            return this.buildTree().then(() => this.getChildren(element));
        }

        if (!element) {
            return this.tree;
        }

        if (element instanceof treeView.WorkspaceDirectoryTreeItem) {
            return element.children;
        }

        if (element instanceof treeView.PipelineTreeItem) {
            // This case occurs when opening a pipeline to see its details. buildTree will not have
            // downloaded that part of the tree yet.
            if (element.children.length === 0) {
                return this.getPipelineDetails(element).then(children => {
                    element.children = children;
                    return children;
                });
            }
            return element.children;
        }

        return [];
    }

    async getPipelines(element: treeView.WorkspaceDirectoryTreeItem): Promise<treeView.SemaphoreTreeItem[]> {
        const project = await this.getProjectOfWorkspaceFolder(element);

        if (!project) {
            return [new treeView.NoSuitableProjectTreeItem()];
        }
        const organisation = project.spec.repository.owner;
        const projectId = project.metadata.id;

        const pipelines = await requests.getPipelines(organisation, projectId, element.branch);

        return pipelines.map((pipeline) => new treeView.PipelineTreeItem(project, pipeline));
    }
}
