# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing yet.

## [0.0.2] - 2026-08-04

### Added

- Comment-only lines are now automatically collapsed while hiding is on, so hiding comments no longer leaves empty lines behind. Runs of consecutive comment-only lines fold into the line above them and expand again when hiding is turned off.
- New setting `hideCommentsAndDisappear.collapseCommentLines` (default `true`) to opt out of the automatic collapse (fold ranges are still provided manually).
- New test suite for the comment-line analysis (`test/commentLines.test.js`); `npm test` now runs both suites.

## [0.0.1] - 2026-08-04

Initial release of the **Hide Comments and Disappear** VS Code extension.

### Added

- Hides `//`, `///`, `//!`, `/* */` and `/*! */` comments from the editor view (visual only, files are never modified) for JavaScript, JSX, TypeScript, TSX, Rust and Go.
- `#region` / `#endregion` comment markers (block style like `/* ── #region Rate limit constants ── */` and line style `// #region`) stay visible and act as fold handles via a custom folding provider.
- Multi-line block comments are individually collapsible.
- Toggle via command palette commands (Toggle / Enable / Disable), status bar item, and keybinding `Cmd+Alt+H` (macOS) / `Ctrl+Alt+H` (Windows/Linux).
- Settings: `hideCommentsAndDisappear.enabled`, `hideCommentsAndDisappear.languages`, `hideCommentsAndDisappear.hideRegionComments`.
- Dependency-free implementation (plain JavaScript, no build step) with a Node test suite for the comment scanner.
