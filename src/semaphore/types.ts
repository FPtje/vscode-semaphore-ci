/* eslint-disable @typescript-eslint/naming-convention */

// These types represent what is returned by Semaphore's REST API. In reality
// the endpoints return much more fields per type. Many of those are not needed
// for now, though it would be interesting to look into them when building new
// features.

// The naming comes from Semaphore itself. See this page for an overview:
// https://docs.semaphoreci.com/essentials/concepts/

export type Project = {
    spec: ProjectSpec;
    metadata: ProjectMetadata;
};

export type ProjectSpec = {
    visibility: string;
    repository: Repository
};

export type ProjectMetadata = {
    ownerId: string;
    orgId: string;
    name: string;
    id: string;
    description: string;
};

export type Repository = {
    url: string;
    owner: string;
    name: string;
};

export type Workflow = {
    wf_id: string;
    initial_ppl_id: string; // Initial pipeline id
    created_at: CreatedAt;
    commit_sha: string;
    branch_name: string;
};

export type CreatedAt = {
    seconds: number;
    nanos: number;
};

export type Pipeline = {
    /** pipeline id */
    ppl_id: string;
    state: PipelineState;
    result: PipelineResult;
    created_at: CreatedAt;
    commit_message: string;
};

/** The result of requesting an individual pipeline with the query parameter detailed=true */
export type PipelineDetails = {
    pipeline: Pipeline;
    blocks: Block[];
};

export enum PipelineState {
    done = "done",
    running = "running",
    stopping = "stopping",
};

export enum PipelineResult {
    passed = "passed",
    stopped = "stopped",
    canceled = "canceled",
    failed = "failed",
};

export type Block = {
    name: string,
    state: PipelineState,
    result: PipelineResult,
    jobs: Job[],
};

export type Job = {
    status: JobStatus,
    result: JobResult,
    name: string,
    job_id: string,
    index: number,
};

export enum JobStatus {
    PENDING = "PENDING",
    QUEUED = "QUEUED",
    RUNNING = "RUNNING",
    FINISHED = "FINISHED",
}

export enum JobResult {
    PASSED = "PASSED",
    FAILED = "FAILED",
}
