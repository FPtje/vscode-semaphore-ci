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
    result = result.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");

    return result;
}

/** Pretty print the output format */
function renderOutputFormat(outputFormat: OutputFormat): string {
    let renderedCommands = outputFormat.map(renderCommandFormat);

    return renderedCommands.join("\n\n");
}

function renderCommandFormat(commandFormat: CommandFormat): string {
    let rendered = [
        `## ${commandFormat.command}`,
        "",
        `Duration: ${commandFormat.duration} seconds`,
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
