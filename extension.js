'use strict';

const vscode = require('vscode');
const { findCommentRanges } = require('./src/commentScanner');
const { analyzeCommentLines } = require('./src/commentLines');
const { CommentFoldingProvider } = require('./src/foldingProvider');

const CONFIG_SECTION = 'hideCommentsAndDisappear';
const UPDATE_DEBOUNCE_MS = 150;
// give the folding model time to pick up fresh provider results before we
// programmatically fold comment-only lines
const FOLD_SETTLE_MS = 250;
// second fold pass, in case the folding model was still computing on the first
const FOLD_RETRY_MS = 400;

/** @type {vscode.TextEditorDecorationType | null} */
let hideDecorationType = null;
/** @type {vscode.StatusBarItem | null} */
let statusBarItem = null;

let enabled = true;
let hideRegionComments = false;
let collapseCommentLines = true;
/** @type {string[]} */
let autoCollapseRegions = [];
/** @type {Set<string>} */
let languages = new Set();

let foldingDisposables = [];
const updateTimers = new Map();
// document uri -> fold trigger lines we collapsed, so we expand exactly those
const foldedLines = new Map();
// document uri -> signature of the folds currently applied (skip re-applying
// unchanged folds on every keystroke, which would also swap selections)
const appliedFoldSignature = new Map();
// documents whose matching regions were already collapsed on open
const autoCollapsedUris = new Set();
// bump to invalidate any in-flight fold refresh
let foldGeneration = 0;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function loadConfig() {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  enabled = cfg.get('enabled', true);
  hideRegionComments = cfg.get('hideRegionComments', false);
  collapseCommentLines = cfg.get('collapseCommentLines', true);
  autoCollapseRegions = (cfg.get('autoCollapseRegions', []) || []).filter((label) => label.trim() !== '');
  languages = new Set(cfg.get('languages', []));
}

/**
 * The hide trick: VS Code copies `textDecoration` verbatim into the
 * decoration's inline style, so we can smuggle `display: none` in after the
 * semicolon and the decorated text disappears from view entirely.
 */
function createHideDecoration() {
  if (hideDecorationType) hideDecorationType.dispose();
  hideDecorationType = vscode.window.createTextEditorDecorationType({
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    textDecoration: 'none; display: none;',
  });
}

function isSupported(document) {
  return languages.has(document.languageId);
}

/**
 * @param {vscode.TextDocument} document
 * @returns {vscode.Range[]}
 */
function computeHiddenRanges(document) {
  const comments = findCommentRanges(document.getText(), document.languageId);
  const ranges = [];
  for (const comment of comments) {
    if (!hideRegionComments && comment.region) {
      // keep #region/#endregion markers visible: they are fold handles
      continue;
    }
    ranges.push(new vscode.Range(document.positionAt(comment.start), document.positionAt(comment.end)));
  }
  return ranges;
}

/**
 * @param {vscode.TextEditor | undefined} editor
 */
function applyToEditor(editor) {
  if (!editor || !hideDecorationType) return;
  if (enabled && isSupported(editor.document)) {
    editor.setDecorations(hideDecorationType, computeHiddenRanges(editor.document));
  } else {
    editor.setDecorations(hideDecorationType, []);
  }
}

function applyToAllEditors() {
  for (const editor of vscode.window.visibleTextEditors) {
    applyToEditor(editor);
  }
}

/**
 * @param {vscode.TextDocument} document
 */
function scheduleUpdate(document) {
  const key = document.uri.toString();
  const existing = updateTimers.get(key);
  if (existing) clearTimeout(existing);
  updateTimers.set(
    key,
    setTimeout(() => {
      updateTimers.delete(key);
      for (const editor of vscode.window.visibleTextEditors) {
        if (editor.document === document) applyToEditor(editor);
      }
      const active = vscode.window.activeTextEditor;
      if (active && active.document === document) refreshFolding(active);
    }, UPDATE_DEBOUNCE_MS)
  );
}

function foldingShouldBeActive(document) {
  return enabled && collapseCommentLines && isSupported(document);
}

/**
 * Collapse comment folds in the active editor.
 *
 * Runs of comment-only lines become MANUAL folding ranges (created from
 * selections via the native command): they apply immediately, are created
 * already-collapsed, and win the folding model's same-start-line merge
 * against provider ranges (e.g. the brace fold of the line above the run),
 * which would otherwise silently discard a provider range anchored there.
 *
 * Multi-line block comments that share lines with code are then collapsed
 * through the native "Fold All Block Comments" command, which folds every
 * Comment-kind region of our folding provider (idempotent, never unfolds).
 * @param {vscode.TextEditor} editor
 * @param {number} generation
 */
async function collapseEditorComments(editor, generation) {
  const document = editor.document;
  const info = analyzeCommentLines(document.getText(), document.languageId);
  const signature =
    JSON.stringify(info.runs.map((run) => [run.foldStart, run.endLine])) +
    '|' +
    JSON.stringify(info.blockFolds.map((fold) => [fold.startLine, fold.endLine]));

  // remember what we folded so we can expand exactly those folds later
  const triggers = [...info.runs.map((run) => run.triggerLine), ...info.blockFolds.map((fold) => fold.triggerLine)];
  foldedLines.set(document.uri.toString(), triggers);

  if (appliedFoldSignature.get(document.uri.toString()) === signature) return;

  if (info.runs.length > 0) {
    const previousSelections = editor.selections;
    editor.selections = info.runs.map(
      (run) =>
        new vscode.Selection(new vscode.Position(run.foldStart, 0), new vscode.Position(run.endLine + 1, 0))
    );
    try {
      await vscode.commands.executeCommand('editor.createFoldingRangeFromSelection');
    } catch {
      // editor.folding disabled — decorations still hide the text
    }
    editor.selections = previousSelections;
  }

  appliedFoldSignature.set(document.uri.toString(), signature);

  if (info.blockFolds.length === 0) return;

  await sleep(FOLD_SETTLE_MS);
  for (const wait of [0, FOLD_RETRY_MS]) {
    if (wait > 0) await sleep(wait);
    if (generation !== foldGeneration) return;
    if (editor !== vscode.window.activeTextEditor) return;
    if (!foldingShouldBeActive(document)) return;
    try {
      await vscode.commands.executeCommand('editor.foldAllBlockComments');
    } catch {
      return;
    }
  }
}

/**
 * Expand exactly the comment folds we collapsed earlier (never the user's
 * own folds — unlike a blunt "unfold all").
 * @param {vscode.TextEditor} editor
 */
async function expandEditorComments(editor) {
  const key = editor.document.uri.toString();
  appliedFoldSignature.delete(key);
  const triggers = foldedLines.get(key);
  if (!triggers || triggers.length === 0) return;
  foldedLines.delete(key);
  if (editor !== vscode.window.activeTextEditor) return;

  try {
    await vscode.commands.executeCommand('editor.unfold', { selectionLines: triggers });
  } catch {
    // nothing to do
  }
}

/**
 * @param {vscode.TextEditor | undefined} editor
 */
function refreshFolding(editor) {
  foldGeneration += 1;
  const generation = foldGeneration;
  if (!editor) return;
  if (foldingShouldBeActive(editor.document)) {
    collapseEditorComments(editor, generation);
  } else {
    expandEditorComments(editor);
  }
}

/**
 * Collapse #region pairs whose label matches `autoCollapseRegions` the first
 * time a document is opened (typically the "Tests" region in Rust files,
 * where tests live in the same file). Runs once per open document; manually
 * expanding it later is respected until the file is closed and reopened.
 * @param {vscode.TextEditor | undefined} editor
 */
async function autoCollapseRegionsIn(editor) {
  if (!editor || autoCollapseRegions.length === 0) return;
  const document = editor.document;
  if (!isSupported(document)) return;
  const key = document.uri.toString();
  if (autoCollapsedUris.has(key)) return;
  autoCollapsedUris.add(key);

  const info = analyzeCommentLines(document.getText(), document.languageId);
  const wanted = autoCollapseRegions.map((label) => label.toLowerCase());
  const targets = info.regionPairs.filter((pair) => {
    const label = pair.label.toLowerCase();
    return label !== '' && wanted.some((needle) => label.includes(needle));
  });
  if (targets.length === 0) return;
  if (editor !== vscode.window.activeTextEditor) return;

  const previousSelections = editor.selections;
  editor.selections = targets.map(
    (pair) => new vscode.Selection(new vscode.Position(pair.startLine, 0), new vscode.Position(pair.endLine, 0))
  );
  try {
    await vscode.commands.executeCommand('editor.createFoldingRangeFromSelection');
  } catch {
    // editor.folding disabled — nothing to collapse
  }
  editor.selections = previousSelections;
}

function registerFoldingProviders() {
  for (const disposable of foldingDisposables) disposable.dispose();
  foldingDisposables = [...languages].map((languageId) =>
    vscode.languages.registerFoldingRangeProvider({ language: languageId }, new CommentFoldingProvider())
  );
}

function updateStatusBar() {
  if (!statusBarItem) return;
  if (enabled) {
    statusBarItem.text = '$(eye-closed) Comments: hidden';
    statusBarItem.tooltip = 'Hide Comments and Disappear is ON — click to show comments again';
  } else {
    statusBarItem.text = '$(eye) Comments: visible';
    statusBarItem.tooltip = 'Hide Comments and Disappear is OFF — click to hide comments';
  }
}

/**
 * @param {boolean} value
 */
function setEnabled(value) {
  enabled = value;
  updateStatusBar();
  applyToAllEditors();
  refreshFolding(vscode.window.activeTextEditor);
  // persist so the choice survives restarts; ignore failures (e.g. no workspace trust)
  vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .update('enabled', value, vscode.ConfigurationTarget.Global)
    .then(undefined, () => {});
}

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  loadConfig();
  createHideDecoration();

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'hideCommentsAndDisappear.toggle';
  updateStatusBar();
  statusBarItem.show();

  registerFoldingProviders();

  context.subscriptions.push(
    statusBarItem,
    { dispose: () => foldingDisposables.forEach((d) => d.dispose()) },
    hideDecorationType,

    vscode.commands.registerCommand('hideCommentsAndDisappear.toggle', () => setEnabled(!enabled)),
    vscode.commands.registerCommand('hideCommentsAndDisappear.enable', () => setEnabled(true)),
    vscode.commands.registerCommand('hideCommentsAndDisappear.disable', () => setEnabled(false)),

    vscode.window.onDidChangeActiveTextEditor((editor) => {
      applyToEditor(editor);
      refreshFolding(editor);
      autoCollapseRegionsIn(editor);
    }),
    vscode.window.onDidChangeVisibleTextEditors(() => applyToAllEditors()),

    vscode.workspace.onDidOpenTextDocument((document) => {
      const active = vscode.window.activeTextEditor;
      if (active && active.document === document) autoCollapseRegionsIn(active);
    }),

    vscode.workspace.onDidCloseTextDocument((document) => {
      const key = document.uri.toString();
      autoCollapsedUris.delete(key);
      foldedLines.delete(key);
      appliedFoldSignature.delete(key);
    }),

    vscode.workspace.onDidChangeTextDocument((event) => {
      if (isSupported(event.document)) scheduleUpdate(event.document);
    }),

    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration(CONFIG_SECTION)) return;
      loadConfig();
      registerFoldingProviders();
      updateStatusBar();
      applyToAllEditors();
      refreshFolding(vscode.window.activeTextEditor);
    })
  );

  applyToAllEditors();
  refreshFolding(vscode.window.activeTextEditor);
  autoCollapseRegionsIn(vscode.window.activeTextEditor);
}

function deactivate() {
  for (const timer of updateTimers.values()) clearTimeout(timer);
  updateTimers.clear();
}

module.exports = { activate, deactivate };
