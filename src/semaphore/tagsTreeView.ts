import * as requests from './requests';
import * as vscode from 'vscode';

import * as treeView from './treeView';
import * as types from './types';

/**
 * The provider for the branch tree view. This class runs the requests to to semaphore and
 * translates them to tree view elements.
 */
export class SemaphoreTagsProvider extends treeView.SemaphoreTreeProvider implements vscode.TreeDataProvider<treeView.SemaphoreTreeItem> {
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
            workspaceFolder.description = "tags";
            workspaceFolder.children = await this.getTags(workspaceFolder);

            let promises: Promise<any>[] = [];
            for (const tagTreeItem of workspaceFolder.children) {
                if (tagTreeItem instanceof treeView.NoSuitableProjectTreeItem) {
                    break;
                }

                if (tagTreeItem instanceof TagTreeItem) {
                    promises.push(this.getPipelines(tagTreeItem).then(async (pipelineItems) => {
                        tagTreeItem.children = pipelineItems;
                        if (tagTreeItem.children.length > 0) {
                            const pipelineItem = tagTreeItem.children[0];
                            tagTreeItem.iconPath = pipelineItem.iconPath;
                        }
                        let pipelinePromises: Promise<any>[] = [];
                        for (const pipelineItem of pipelineItems) {
                            const pipelineId = pipelineItem.pipeline.ppl_id;
                            // Optimization: Do not load pipeline details if the item is not
                            // expanded in the tree view.
                            if (!this.expandedPipelines.has(pipelineId)) {
                                continue;
                            };

                            pipelinePromises.push(this.getPipelineDetails(pipelineItem).then(children => {
                                pipelineItem.children = children;
                            }));
                        }
                        await Promise.all(pipelinePromises);
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

        if (element instanceof TagTreeItem) {
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

    async getTags(element: treeView.WorkspaceDirectoryTreeItem): Promise<treeView.SemaphoreTreeItem[]> {
        const project = await this.getProjectOfWorkspaceFolder(element);

        if (!project) {
            return [new treeView.NoSuitableProjectTreeItem()];
        }

        const organisation = project.organisation;
        const projectId = project.project.metadata.id;

        const tagReferences = await requests.getTags(organisation, projectId);
        let tagTreeItems: TagTreeItem[] = [];
        for (const tagReference of tagReferences) {
            tagTreeItems.push(new TagTreeItem(project, tagReference));
        }

        return tagTreeItems;
    }

    async getPipelines(element: TagTreeItem): Promise<treeView.PipelineTreeItem[]> {
        const project = element.project;
        const organisation = project.organisation;
        const projectId = project.project.metadata.id;
        const branchName = `refs/tags/${element.tagReference.tagName}`;

        const pipelines = await requests.getPipelines(organisation, projectId, branchName);
        return pipelines.map((pipeline) => new treeView.PipelineTreeItem(project, pipeline));
    }
}

/** Represents a tag in the tags tree view */
export class TagTreeItem extends treeView.SemaphoreTreeItem {
    public children: treeView.PipelineTreeItem[] = [];

    constructor(
        public readonly project: types.OrganisationProject,
        public readonly tagReference: types.TagReference
    ) {
        super(tagReference.tagName, vscode.TreeItemCollapsibleState.Collapsed);
    }
}
