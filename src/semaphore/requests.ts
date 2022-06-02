import axios, { AxiosResponse } from 'axios';
import * as vscode from 'vscode';

import * as types from './types';

export async function getProjects(): Promise<types.Project[]> {
    let organisations: string[] = vscode.workspace.getConfiguration("semaphore-ci").organisations;
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

// Kinds of resources that can be accessed through the semaphore API
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

function semaphoreGet<T = any>(url: string): Promise<AxiosResponse<T, any>> {
    let apiKey = vscode.workspace.getConfiguration("semaphore-ci").apiKey;
    return retryRequest(() => axios.get<T>(url, { headers: { authorization: `Token ${apiKey}` } }));
};


// Semaphore's API often give 500/503 errors. These can be retried.
function retryRequest(runRequest: () => Promise<AxiosResponse<any>>, retryAmount: number = 10): Promise<AxiosResponse<any>> {
    let retryCount: number = retryAmount;

    function innerRetry(response: AxiosResponse<any>): Promise<AxiosResponse<any>> {
        if (response.status >= 500 && response.status < 600) {
            retryCount -= retryCount;
            runRequest().then(innerRetry);
        }

        return new Promise((resolve, _reject) => resolve(response));
    }

    return runRequest().then(innerRetry);
}
