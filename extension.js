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
/** @type {Set<string>} */
let languages = new Set();

let foldingDisposables = [];
const updateTimers = new Map();
// document uri -> fold trigger lines we collapsed, so we expand exactly those
const foldedLines = new Map();
// bump to invalidate any in-flight fold refresh
let foldGeneration = 0;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function loadConfig() {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  enabled = cfg.get('enabled', true);
  hideRegionComments = cfg.get('hideRegionComments', false);
  collapseCommentLines = cfg.get('collapseCommentLines', true);
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
 * Collapse all comment folds in the active editor using VS Code's native
 * "Fold All Block Comments" command: with our folding provider registered it
 * folds every Comment-kind region (comment-only runs and block comments),
 * is idempotent, and never unfolds anything.
 * @param {vscode.TextEditor} editor
 * @param {number} generation
 */
async function collapseEditorComments(editor, generation) {
  await sleep(FOLD_SETTLE_MS);
  for (const wait of [0, FOLD_RETRY_MS]) {
    if (wait > 0) await sleep(wait);
    if (generation !== foldGeneration) return;
    if (editor !== vscode.window.activeTextEditor) return;
    if (!foldingShouldBeActive(editor.document)) return;
    try {
      await vscode.commands.executeCommand('editor.foldAllBlockComments');
    } catch {
      return; // editor.folding disabled — decorations still hide the text
    }
  }
  // remember what we folded so we can expand exactly those folds later
  const info = analyzeCommentLines(editor.document.getText(), editor.document.languageId);
  const triggers = [...info.runs.map((run) => run.triggerLine), ...info.blockFolds.map((fold) => fold.triggerLine)];
  if (triggers.length > 0) {
    foldedLines.set(editor.document.uri.toString(), triggers);
  }
}

/**
 * Expand exactly the comment folds we collapsed earlier (never the user's
 * own folds — unlike a blunt "unfold all").
 * @param {vscode.TextEditor} editor
 */
async function expandEditorComments(editor) {
  const key = editor.document.uri.toString();
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
    }),
    vscode.window.onDidChangeVisibleTextEditors(() => applyToAllEditors()),

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
}

function deactivate() {
  for (const timer of updateTimers.values()) clearTimeout(timer);
  updateTimers.clear();
}

module.exports = { activate, deactivate };
