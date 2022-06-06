import axios, { AxiosError, AxiosResponse } from 'axios';
import * as vscode from 'vscode';

import * as types from './types';
import * as apiKey from './apiKey';

/** Get the projects belonging to the list of organisations as configured in the settings. */
export async function getProjects(organisations: string[]): Promise<types.Project[]> {
    let promises: Promise<AxiosResponse<types.Project[], any>>[] = [];

    organisations.forEach(organisation => {
        let promise = semaphoreGet<types.Project[]>(baseUrl(organisation, ResourceName.projects));
        promises.push(promise);
    });

    const responses = await Promise.all(promises);
    let projects: types.Project[] = [];
    responses.forEach(response => {
        projects = projects.concat(response.data);
    });

    return projects;
};

/** Get the pipelines belonging to a given organisation's project and branch */
export async function getPipelines(organisation: string, projectId: string, branchName: string):
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
export async function getPipelineDetails(organisation: string, pipelineId: string):
    Promise<types.PipelineDetails> {
    const base = baseUrl(organisation, ResourceName.pipelines);
    const url = `${base}/${pipelineId}`;

    const response = await semaphoreGet<types.PipelineDetails>(url, { detailed: "true" });
    return response.data;
}

/** Kinds of resources that can be accessed through the semaphore API */
enum ResourceName {
    projects = "projects",
    workflows = "plumber-workflows",
    pipelines = "pipelines",
    promotions = "promotions",
    jobs = "jobs",
};

function baseUrl(organisation: string, resourceName: ResourceName): string {
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
