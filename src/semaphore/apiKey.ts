import * as path from 'path';
import * as vscode from 'vscode';
import fse = require('fs-extra');


let apiKey: string | undefined;

/** Get the API key, returns null if it's not set */
export async function getApiKey(): Promise<string | undefined> {
    if (apiKey && apiKey !== "") {
        markApiKeySet(true);
        return apiKey;
    }

    const keyPath = await secretConfigPath();

    const exists = await fse.pathExists(keyPath);
    if (!exists) {
        markApiKeySet(false);
        return;
    }

    const configContents = await fse.readFile(keyPath, { encoding: "utf-8" });
    try {
        const key = JSON.parse(configContents).apiKey;
        apiKey = key;
        markApiKeySet(true);
        return apiKey;
    } catch (error) {
        markApiKeySet(false);
        return;
    }
}

/** Set the API key, removing the file when unset */
export async function setApiKey(key: string | undefined) {
    apiKey = key;
    const keyPath = await secretConfigPath();

    // Remove the file when unset
    if (key === '' || !key) {
        markApiKeySet(false);
        const stat = await fse.stat(keyPath);
        if (!stat.isFile) {
            return;
        }

        fse.rm(keyPath);
    }

    markApiKeySet(true);

    await fse.writeFile(
        keyPath,
        JSON.stringify({
            apiKey: key
        }), { flag: "w" }
    );
}

/** For the welcome screen that says the API key is not set. */
function markApiKeySet(set: boolean) {
    vscode.commands.executeCommand('setContext', 'semaphore-ci.apiKeySet', set);
}

/** For the welcome screen that says the API key is not set. */
export function markApiKeyIncorrect(incorrect: boolean) {
    vscode.commands.executeCommand('setContext', 'semaphore-ci.apiKeyIncorrect', incorrect);
}

/** Returns the location where the API key will be stored */
async function secretConfigPath(): Promise<string> {
    const envPaths = require('env-paths-ts');
    const homeDir = envPaths.default('semaphore-ci', { suffix: 'vscode' }).data;
    // Make sure the directory exists
    await fse.ensureDir(homeDir);

    const configFileName = "config.json";

    return path.join(homeDir, configFileName);
}
