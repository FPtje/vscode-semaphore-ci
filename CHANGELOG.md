# Changelog

All notable changes to the "semaphoreci" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
