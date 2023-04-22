import axios, { AxiosError, AxiosResponse } from 'axios';
import { v4 as uuidv4 } from 'uuid';

import * as types from './types';
import * as apiKey from './apiKey';

/** Get the projects belonging to the list of organisations as configured in the settings. */
export async function getProjects(organisations: types.Organisation[]): Promise<Map<types.Organisation, types.Project[]>> {
    let promises: Promise<void>[] = [];

    let organisationProjectMap = new Map<string, types.Project[]>;

    organisations.forEach(organisation => {
        let promise = semaphoreGet<types.Project[]>(baseUrl(organisation, ResourceName.projects));
        promises.push(promise.then(response => {
            organisationProjectMap.set(organisation, response.data);
        }));
    });

    await Promise.all(promises);

    return organisationProjectMap;
};

/** Get the pipelines belonging to a given organisation's project and branch */
export async function getPipelines(organisation: types.Organisation, projectId: string, branchName: string):
    Promise<types.Pipeline[]> {
    const url = baseUrl(organisation, ResourceName.pipelines);

    const response = await semaphoreGet<types.Pipeline[]>(
        url,
        // eslint-disable-next-line @typescript-eslint/naming-convention
        { project_id: projectId, branch_name: branchName }
    );
    return response.data;
}

/** The details of a pipeline, which contains data about the blocks and jobs */
export async function getPipelineDetails(organisation: types.Organisation, pipelineId: string):
    Promise<types.PipelineDetails> {
    const base = baseUrl(organisation, ResourceName.pipelines);
    const url = `${base}/${pipelineId}`;

    const response = await semaphoreGet<types.PipelineDetails>(url, { detailed: "true" });
    return response.data;
}

export async function getJobLogs(organisation: types.Organisation, jobId: string): Promise<types.JobLog> {
    // This base is different, it doesn't have the `api/v1alpha` part
    const base = `https://${organisation}.semaphoreci.com/jobs`;
    const url = `${base}/${jobId}/logs`;

    const response = await semaphoreGet<types.JobLog>(url);
    return response.data;
}

export async function getJobDescription(organisation: types.Organisation, jobId: string): Promise<types.JobDescription> {
    const base = baseUrl(organisation, ResourceName.jobs);
    const url = `${base}/${jobId}`;

    const response = await semaphoreGet<types.JobDescription>(url);
    return response.data;
}

export async function stopJob(organisation: types.Organisation, jobId: string): Promise<void> {
    const base = baseUrl(organisation, ResourceName.jobs);
    const url = `${base}/${jobId}/stop`;

    await semaphorePost<void>(url);
}

/** Resubmit a workflow for rerunning */
export async function rerunWorkflow(organisation: types.Organisation, workflowId: string): Promise<void> {
    const base = baseUrl(organisation, ResourceName.workflows);
    // Idempotency token (can be any string). Let's set it to an uuid to make sure every call of
    // this function runs the restart. The choice of uuid was informed by the `sem` tool, which also
    // uses a UUID here.
    const requestToken = uuidv4();
    const url = `${base}/${workflowId}/reschedule`;
    // eslint-disable-next-line @typescript-eslint/naming-convention
    await semaphorePost(url, { request_token: requestToken });
}

/** Getting tags is a little tricky. We need to get an HTML subpage and filter out the tags from
 * there. */
export async function getTags(organisation: types.Organisation, projectId: string): Promise<types.TagReference[]> {
    const url = `https://${organisation}.semaphoreci.com/projects/${projectId}/workflows?type=tag`;
    const response = await semaphoreGet<string>(url);
    const regex = /href="\/branches\/([a-z0-9-]+)"\s*>([^<\s]+)\s*<\/a>/igm;
    const tags = [...response.data.matchAll(regex)];
    let result: types.TagReference[] = [];

    tags.forEach(tag => {
        result.push(new types.TagReference(tag[2], tag[1]));
    });

    return result;
}

/** Kinds of resources that can be accessed through the semaphore API */
enum ResourceName {
    projects = "projects",
    workflows = "plumber-workflows",
    pipelines = "pipelines",
    promotions = "promotions",
    jobs = "jobs",
};

function baseUrl(organisation: types.Organisation, resourceName: ResourceName): string {
    return `https://${organisation}.semaphoreci.com/api/v1alpha/${resourceName}`;
}

async function semaphoreGet<T = any>(url: string, params: object = {}):
    Promise<AxiosResponse<T, any>> {
    const key = await apiKey.getApiKey();

    return retryRequest(() => axios.get<T>(
        url,
        { headers: { authorization: `Token ${key}` }, params: params })
    );
};

async function semaphorePost<T = any>(url: string, params: object = {}):
    Promise<AxiosResponse<T, any>> {
    const key = await apiKey.getApiKey();

    return retryRequest(() => axios.post<T>(
        url, null, {
        headers: {
            authorization: `Token ${key}`,
            // eslint-disable-next-line @typescript-eslint/naming-convention
            "Content-Type": "application/json",

            // eslint-disable-next-line @typescript-eslint/naming-convention
            "User-Agent": "SemaphoreCI v2.0 Client",
        },
        params: params
    })
    );
};


/** Semaphore's API often give HTTP 5XX errors. These can be retried. */
async function retryRequest(
    runRequest: () => Promise<AxiosResponse<any>>,
    retryAmount: number = 10):
    Promise<AxiosResponse<any>> {

    let retryCount: number = retryAmount;

    function catchError(error: AxiosError): Promise<AxiosResponse<any>> {
        retryCount -= 1;

        const requestSummary = `${error.request.method} ${error.request.host}${error.request.path}`;
        let response = error.response;

        if (!response) {
            console.log(`Request ${requestSummary} failed: ${error.message}`);
        } else {
            // When the error is specifically 401, we can retry, but it is very likely that the API
            // key is incorrect. Show a welcome screen to explain that situation.
            if (response.status === 401) {
                apiKey.markApiKeyIncorrect(true);
            }
            console.log(
                `Request ${requestSummary} failed with status code ${response.status}. ` + `
                Retrying, ${retryCount} attempts left.`
            );
        }

        if (retryCount >= 1) {
            return runRequest().catch(catchError);
        }
        else {
            return runRequest();
        }
    }

    return runRequest().catch(catchError);
}
