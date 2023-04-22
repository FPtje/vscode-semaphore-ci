/* eslint-disable @typescript-eslint/naming-convention */

// These types represent what is returned by Semaphore's REST API. In reality
// the endpoints return much more fields per type. Many of those are not needed
// for now, though it would be interesting to look into them when building new
// features.

// The naming comes from Semaphore itself. See this page for an overview:
// https://docs.semaphoreci.com/essentials/concepts/

export type Organisation = string;

/**
 * Combination of an organisation and the projects it contains.
 */
export type OrganisationProject = {
    organisation: Organisation;
    project: Project;
};

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
    /** workflow id */
    wf_id: string;
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
    pending = "PENDING",
    queuing = "QUEUING",
    initializing = "INITIALIZING",
    running = "RUNNING",
    stopping = "STOPPING",
    done = "DONE",
};

export enum PipelineResult {
    passed = "PASSED",
    stopped = "STOPPED",
    canceled = "CANCELED",
    failed = "FAILED",
};

export type Block = {
    name: string,
    state: BlockState,
    result: BlockResult,
    result_reason: string, // The possible values of this are not documented
    jobs: Job[],
};

export enum BlockResult {
    passed = "passed",
    stopped = "stopped",
    canceled = "canceled",
    failed = "failed",
};

export enum BlockState {
    done = "done",
    running = "running",
    stopping = "stopping",
    waiting = "waiting",
};

export type Job = {
    status: JobStatus,
    result: JobResult,
    name: string,
    job_id: string,
    index: number,
};

export enum JobStatus {
    pending = "PENDING",
    queued = "QUEUED",
    enqueued = "ENQUEUED", // Apparently this also exists
    running = "RUNNING",
    finished = "FINISHED",
}

export enum JobResult {
    passed = "PASSED",
    failed = "FAILED",
    stopped = "STOPPED",
}

// Related to job logs
export type JobLog = {
    next: null,
    events: JobLogEvent[],
};

export type JobLogEvent = {
    event: JobLogEventType
    timestamp: number,

    // cmd_output
    output?: string,

    // cmd_started and cmd_finished
    directive?: string,

    // cmd_finished
    exit_code?: number,
    started_at?: number,
    finished_at?: number,

    // job_finished
    result?: BlockResult,
};

export type JobDescription = {
    metadata: JobDescriptionMetadata,
    spec: JobDescriptionSpec,
    status: JobDescriptionStatus
};

export type JobDescriptionMetadata = {
    name: string,
    id: string,
    create_time: string,
    update_time: string,
    start_time: string,
    finish_time: string | undefined,
};

export type JobDescriptionSpec = {
    project_id: string,
    agent: any,
    env_vars: [{ name: string, value: string }],
    commands: string[],
};

export type JobDescriptionStatus = {
    result: JobResult,
    state: JobStatus,
    agent: {
        ip: string,
        ports: [{ name: string, number: number }],
    },
};

export enum JobLogEventType {
    cmdStarted = "cmd_started",
    cmdOutput = "cmd_output",
    cmdFinished = "cmd_finished",
    JobStarted = "job_started",
    jobFinished = "job_finished",
}

export class TagReference {
    constructor(
        public readonly tagName: string,
        public readonly branchId: string) { }
};

export function formatTime(seconds: number): string {
    const timestamp = new Date(seconds * 1000);

    const months = (timestamp.getMonth() + 1).toString().padStart(2, "0");
    const days = (timestamp.getDay() + 1).toString().padStart(2, "0");
    const hour = (timestamp.getHours()).toString().padStart(2, "0");
    const minute = (timestamp.getMinutes()).toString().padStart(2, "0");

    return `${timestamp.getFullYear()}-${months}-${days} ${hour}:${minute}`;
}
