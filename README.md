# Hide Comments and Disappear

Hide all code comments from the editor view with a single toggle — purely visual, your files are never modified.

## Features

- **Hides all comment styles** from the editor view using decorations:
  - `//` line comments
  - `///` doc comments
  - `//!` module-level doc comments
  - `/* */` block comments
  - `/*! */` preserved block comments
- **Purely visual.** The document text is never modified. Search, line numbers, git diffs, and compilation are all unaffected. Comments only disappear from what you *see*.
- **Region markers stay visible** as fold handles by default (see [Region folding](#region-folding)).
- **Folding support.** Regions collapse/expand, and multi-line block comments are individually collapsible (like VS Code's native "Fold All Block Comments").
- **Quick toggle** via command palette, keyboard shortcut, or status bar.
- **No telemetry.** Collects nothing, no network access.

## Usage

### Status bar

A status bar item on the right shows the current state (comments hidden or visible). Click it to toggle.

### Command palette

| Command | Effect |
| --- | --- |
| `Hide Comments and Disappear: Toggle Hide Comments` | Switch between hidden and visible |
| `Hide Comments and Disappear: Enable (Hide Comments)` | Force hidden |
| `Hide Comments and Disappear: Disable (Show Comments)` | Force visible |

Command ids: `hideCommentsAndDisappear.toggle`, `hideCommentsAndDisappear.enable`, `hideCommentsAndDisappear.disable`.

### Keyboard shortcut

Toggle comment hiding with:

- **macOS:** `Cmd+Alt+H`
- **Windows / Linux:** `Ctrl+Alt+H`

## Region folding

Comments containing `#region` / `#endregion` markers are **not** hidden by default. They stay visible as fold handles, and the extension registers a folding provider so you can collapse and expand the code between them.

Both styles are recognized:

Block style:

```javascript
/* ── #region Rate limit constants ── */
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 100;
/* ── #endregion ── */
```

Line style:

```javascript
// #region Rate limit constants
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 100;
// #endregion
```

Multi-line block comments are also individually collapsible, independent of regions.

To hide region marker comments as well, set `hideCommentsAndDisappear.hideRegionComments` to `true`.

## Settings

Configure via VS Code settings JSON:

| Setting | Type | Default | Description |
| --- | --- | --- | --- |
| `hideCommentsAndDisappear.enabled` | boolean | `true` | Whether comment hiding is active. |
| `hideCommentsAndDisappear.languages` | array of language ids | `["javascript", "javascriptreact", "typescript", "typescriptreact", "rust", "go"]` | Languages in which comments are hidden. Add more language ids such as `"c"`, `"cpp"`, or `"csharp"`. |
| `hideCommentsAndDisappear.hideRegionComments` | boolean | `false` | When `true`, `#region` / `#endregion` marker comments are hidden too instead of kept as fold handles. |

Example:

```json
{
  "hideCommentsAndDisappear.enabled": true,
  "hideCommentsAndDisappear.languages": [
    "javascript",
    "typescript",
    "csharp",
    "cpp"
  ],
  "hideCommentsAndDisappear.hideRegionComments": false
}
```

## Supported languages

Comment hiding is enabled by default for:

- JavaScript (`javascript`)
- JavaScript React (`javascriptreact`)
- TypeScript (`typescript`)
- TypeScript React (`typescriptreact`)
- Rust (`rust`)
- Go (`go`)

Any language can be added by appending its language id to `hideCommentsAndDisappear.languages` (for example `"c"`, `"cpp"`, `"csharp"`).

## Install

### From a `.vsix`

```bash
code --install-extension hide-comments-and-disappear-0.0.1.vsix
```

Or in VS Code / VSCodium: open the Extensions view, open the `...` menu, and choose **Install from VSIX...**.

### From source

```bash
git clone https://github.com/enriquesouza/hide-comments-and-disappear.git
```

Then either:

- Open the folder in VS Code and press `F5` (Run Extension) to launch a development host with the extension active, or
- Copy (or symlink) the folder into `~/.vscode/extensions/` and restart VS Code.

## Development

No build step — the extension is plain JavaScript.

- **Tests:** `npm test` runs the scanner test suite (`node test/scanner.test.js`).
- **Samples:** the `examples/` folder contains sample `.js`, `.ts`, `.rs`, and `.go` files to try the extension on.

## Known limitations

1. **Comment-like sequences inside JSX text nodes or regex literals** may occasionally be misdetected. This is an inherent limitation of a lightweight scanner that does not perform full parsing.
2. **The minimap may still show faint comment text**, because decorations do not affect minimap rendering.
3. **Hiding is visual only** — comments remain in the file and still appear in search, git diffs, and any tool that reads the document text.

## License

MIT
