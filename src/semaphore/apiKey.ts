import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as osPaths from 'os-paths/cjs';
import * as vscode from 'vscode';

let apiKey: string | undefined;

/** Get the API key, returns null if it's not set */
export async function getApiKey(): Promise<string | undefined> {
    if (apiKey && apiKey !== "") {
        markApiKeySet(true);
        return apiKey;
    }

    const keyPath = secretConfigPath();

    const stat = await fs.promises.stat(keyPath);
    if (!stat.isFile) {
        markApiKeySet(false);
        return;
    }

    const configContents = await fs.promises.readFile(keyPath, {encoding: "utf-8"});
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
    const keyPath = secretConfigPath();

    // Remove the file when unset
    if (key === '' || !key) {
        markApiKeySet(false);
        const stat = await fs.promises.stat(keyPath);
        if (!stat.isFile) {
            return;
        }

        fs.promises.rm(keyPath);
    }

    markApiKeySet(true);

    await fs.promises.writeFile(
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
function secretConfigPath(): string {
    const home = osPaths.home() || "";
    const configFileName = "vs-code-semaphore-ci-extension.json";
    if (!home) { return configFileName; }

    let configPath: string;

    if (os.platform() === 'win32') {
        configPath = path.join('AppData', 'Local');
    } else {
        configPath = path.join('.config');
    }

    return path.join(home, configPath, configFileName);
}
