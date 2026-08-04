# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing yet.

## [0.0.5] - 2026-08-04

### Added

- Matching `#region` pairs are now automatically collapsed the first time a file is opened — by default any region whose label contains "Tests" (case-insensitive), which is aimed at Rust files that keep `#[cfg(test)] mod tests` in the same file. Configure via `hideCommentsAndDisappear.autoCollapseRegions` (labels to match; `[]` disables). Manually expanding a collapsed region is respected until the file is closed.

### Changed

- Region pairing/label extraction moved into the shared line-analysis module and is covered by new tests.
- `examples/sample.rs` now includes a `#region Tests` block with a `#[cfg(test)]` module.

## [0.0.4] - 2026-08-04

### Fixed

- Comment-only runs directly below a `{` line (the most common placement, e.g. at the top of a function body) were not collapsing: VS Code's folding model drops a provider range that starts on the same line as another provider's range (the brace fold). Runs are now collapsed as native *manual* folding ranges (`editor.createFoldingRangeFromSelection`), which take precedence in that merge, apply immediately, and are created already-collapsed.
- Folds are re-applied only when the comment layout actually changes, so typing no longer triggers repeated fold/selection churn.

## [0.0.3] - 2026-08-04

### Changed

- Comment collapsing now uses VS Code's native "Fold All Block Comments" mechanism (`editor.foldAllBlockComments`): with the extension's typed folding provider active, every Comment-kind fold region (comment-only runs and multi-line block comments) collapses in one idempotent pass, with a retry pass for folding models that are still computing.
- Multi-line block comments that overlap a comment-only run are no longer emitted as separate folds; the run fold covers them.

### Fixed

- Edge case where a block-comment fold nested inside a run fold could be collapsed first, leaving part of the comment run visible as empty lines.

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
