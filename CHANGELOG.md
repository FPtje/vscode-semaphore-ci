# Changelog

All notable changes to the "semaphoreci" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.2] - 22-07-05

### Added

- Added more info on the job logs page: job id, started, finished, duration.

## [0.2.1] - 22-07-04

### Fixed

- Fixed job log button not showing for finished jobs.
- Fixed an error about a missing pipeline state (pending).

## [0.2.0] - 22-07-03

### Added

- Button to stop jobs.
- Button to rerun workflows.

### Fixed

- Workaround for buttons not working. See https://github.com/FPtje/vscode-semaphore-ci/issues/5

## [0.1.1] - 22-07-01

### Fixed

- Something went wrong with packaging, causing the reload timer not to work.
  Hopefully repackaging it works.

## [0.1.0] - 22-06-30

### Added

- Added autorefresh feature! With this feature, your semaphore status will
  refresh automatically every 5 seconds. See the `semaphore-ci` settings to set
  the autorefresh delay.

  Fixes #3

### Fixed

- Fix rendering of multiline commands in job logs.

## [0.0.4] - 2022-06-25

### Changed

- Rewrote the job log output to show a Markdown file

### Fixed

- Fixed job logs not reloading when re-opening the file. Fixes [#1](https://github.com/FPtje/vscode-semaphore-ci/issues/1)
- Fixed job logs sometimes still showing terminal control characters. Fixes [#2](https://github.com/FPtje/vscode-semaphore-ci/issues/2)

## [0.0.3] - 2022-06-22

### Fixed

- Fixed "Set API key" screen from appearing and then disappearing after starting VS Code.

## [0.0.2] - 2022-06-21

### Changed

- The extension will now only ask to set the organisations when the API key is set.
- The extension will now only ask to set the API key when the organisations are set.

### Fixed

- The extension no longer makes requests when the API key is not set.

## [0.0.1] - 2022-06-08

- Initial release
