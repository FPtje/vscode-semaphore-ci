import axios, { AxiosResponse } from 'axios';
import * as vscode from 'vscode';

import * as types from './types';

/** Get the projects belonging to the list of organisations as configured in the settings. */
export async function getProjects(): Promise<types.Project[]> {
    const organisations: string[] = vscode.workspace.getConfiguration("semaphore-ci").organisations;
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
export async function getPipelines(organisation: string, projectId: string, branchName: string): Promise<types.Pipeline[]> {
    const url = baseUrl(organisation, ResourceName.pipelines);

    // eslint-disable-next-line @typescript-eslint/naming-convention
    const response = await semaphoreGet<types.Pipeline[]>(url, { project_id: projectId, branch_name: branchName });
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

function semaphoreGet<T = any>(url: string, params: object = {}): Promise<AxiosResponse<T, any>> {
    let apiKey = vscode.workspace.getConfiguration("semaphore-ci").apiKey;
    return retryRequest(() => axios.get<T>(url, { headers: { authorization: `Token ${apiKey}` }, params: params }));
};


/** Semaphore's API often give HTTP 5XX errors. These can be retried. */
async function retryRequest(runRequest: () => Promise<AxiosResponse<any>>, retryAmount: number = 10): Promise<AxiosResponse<any>> {
    let retryCount: number = retryAmount;

    function innerRetry(response: AxiosResponse<any>): Promise<AxiosResponse<any>> {
        if (response.status >= 500 && response.status < 600) {
            retryCount -= retryCount;
            console.log(`Request failed with status code ${response.status}. Retrying, ${retryCount} attempts left.`);

            if (retryCount <= 1) {
                runRequest().then(innerRetry);
            }
            else {
                runRequest();
            }
        }

        return Promise.resolve(response);
    }

    const response = await runRequest();
    return innerRetry(response);
}


// Scratchpad:
// https://channable.semaphoreci.com/api/v1alpha/pipelines/c5d119bb-c8b6-4204-ac5d-e544ba749e8d?detailed=true

// https://channable.semaphoreci.com/api/v1alpha/plumber-workflows?project_id=6152b604-a7af-499c-8215-8c9da2994cf8&branch_name=testing
// Note: Has a LOT of timeouts!
