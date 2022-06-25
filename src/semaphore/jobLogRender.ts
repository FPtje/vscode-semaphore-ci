import formatDuration = require('format-duration');

import * as types from './types';

/** Render a job log to a nice string */
export function renderJobLog(jobLog: types.JobLog): string {
    const outputFormat = eventsToOutputFormat(jobLog.events);

    return renderOutputFormat(outputFormat);
}

function eventsToOutputFormat(events: types.JobLogEvent[]): OutputFormat {
    let commands: CommandFormat[] = [];
    const initialCommand: CommandFormat = {
        command: "",
        duration: 0,
        exitCode: 0,
    };
    let currentCommand: CommandFormat | null = null;
    let currentOutput: string[] = [];

    for (const event of events) {
        switch (event.event) {
            case types.JobLogEventType.cmdStarted: {
                currentCommand = { ...initialCommand };
                currentCommand.command = event.directive || "";
                break;
            }
            case types.JobLogEventType.cmdOutput: {
                // Ignore output when no cmdStarted matches
                if (currentCommand === null) {
                    break;
                }

                currentOutput.push(event.output || "");
                break;
            }
            case types.JobLogEventType.cmdFinished: {
                // Cannot finish a command that has not started
                if (currentCommand === null) {
                    break;
                }

                const finishedAt = event.finished_at || 0;
                const startedAt = event.started_at || 0;
                const exitCode = event.exit_code || 0;

                currentCommand.duration = finishedAt - startedAt;
                currentCommand.exitCode = exitCode;
                currentCommand.output = formatCommandOutput(currentOutput);

                commands.push(currentCommand);
                currentCommand = null;
                currentOutput = [];
                break;
            }
            case types.JobLogEventType.JobStarted: {
                // ignore, job info is visible in other places.
                break;
            }
            case types.JobLogEventType.jobFinished: {
                // ignore, job info is visible in other places.
                break;
            }
        }
    }

    return commands;
}

/** Convert the messages list to a single representable string */
function formatCommandOutput(commandOutput: string[]): string {
    let result = commandOutput.join("").trimEnd();

    // From: https://github.com/chalk/ansi-regex
    // License: MIT
    const ansiRegex = [
        '[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)',
        '(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]))'
    ].join('|');

    result = result.replace(RegExp(ansiRegex, 'g'), "");

    result = stripRewrittenLines(result);

    return result;
}

/**
 * Some CLI applications use a single line in the terminal that is updated. This is done with
 * carriage returns. For example, the following string is rewritten:
 *
 * ```
 * Download status: 50%\rDownload status: 100%
 * ```
 *
 * Is simply shown in the terminal as `Download status: 100%`. However, the job log would print all
 * intermediate statuses if not filtered.
 */
function stripRewrittenLines(output: string): string {
    let split = output.split('\n');

    for (let index = 0; index < split.length; index++) {
        let line = split[index];
        const lastIndex = line.lastIndexOf('\r');

        // Carriage return not found
        if (lastIndex === -1) {
            continue;
        }

        // Carriage return is found as the last character. Remove the last carriage return from the
        // line and re-run the iteration. That way, the last printed line will be shown.
        if (lastIndex === line.length - 1) {
            split[index] = line.substring(0, line.length - 1); // remove last character
            index = index - 1;
        // Carriage return is found anywhere else: remove everything up to and including that
        // carriage return.
        } else {
            split[index] = line.substring(lastIndex + 1);
        }
    }

    return split.join('\n');
}

/** Pretty print the output format */
function renderOutputFormat(outputFormat: OutputFormat): string {
    let renderedCommands = outputFormat.map(renderCommandFormat);

    return renderedCommands.join("\n\n");
}

function renderCommandFormat(commandFormat: CommandFormat): string {
    const duration = formatDuration(1000 * commandFormat.duration);
    let rendered = [
        `## ${commandFormat.command}`,
        "",
        `Duration: ${duration}`,
        `Exit code: ${commandFormat.exitCode}`,
    ];
    if ('output' in commandFormat && commandFormat.output !== undefined && commandFormat.output !== "") {
        rendered = rendered.concat([
            "",
            "Log: ",
            "```",
            commandFormat.output,
            "```",
        ]);
    }

    return rendered.join("\n");
}

/** The job log format is just a list of events. For the output it's nicer to show a list of
 * commands, with its details. */
type OutputFormat = CommandFormat[];

type CommandFormat = {
    command: string,
    duration: number,
    exitCode: number,
    output?: string,
};
