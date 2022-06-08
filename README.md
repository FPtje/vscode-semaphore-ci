# semaphoreci

Connect with Semaphore CI and show your build status, right in your editor!

## Features

Show the most recent runs of the current checked out branch, with details showing status of individual blocks and jobs.

![Semaphore main view](./images/semaphore-ci-view.png)

## Extension Settings

This extension contributes the following settings:

* `semaphore-ci.organisations`: The list of organisations that you have access to.

## Credits

* Semaphore logo taken from [gilbarbara/logos](https://github.com/gilbarbara/logos) ([LICENSE](https://github.com/gilbarbara/logos/blob/40f3135/LICENSE.txt)).
* Some other logos taken and modified from the [vscode/python](https://github.com/microsoft/vscode-python) extension ([LICENSE](https://github.com/microsoft/vscode-python/blob/1187381/LICENSE)).

## Release Notes

See [CHANGELOG](./CHANGELOG.md).

## Known Issues

When opening a job's log while it is still running, it will not refresh, even after closing and reopening the job log.

### 0.0.1

Initial release
