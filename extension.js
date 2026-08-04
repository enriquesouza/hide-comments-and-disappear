'use strict';

const vscode = require('vscode');
const { findCommentRanges } = require('./src/commentScanner');
const { CommentFoldingProvider } = require('./src/foldingProvider');

const CONFIG_SECTION = 'hideCommentsAndDisappear';
const UPDATE_DEBOUNCE_MS = 150;

/** @type {vscode.TextEditorDecorationType | null} */
let hideDecorationType = null;
/** @type {vscode.StatusBarItem | null} */
let statusBarItem = null;

let enabled = true;
let hideRegionComments = false;
/** @type {Set<string>} */
let languages = new Set();

let foldingDisposables = [];
const updateTimers = new Map();

function loadConfig() {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  enabled = cfg.get('enabled', true);
  hideRegionComments = cfg.get('hideRegionComments', false);
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
    }, UPDATE_DEBOUNCE_MS)
  );
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

    vscode.window.onDidChangeActiveTextEditor((editor) => applyToEditor(editor)),
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
    })
  );

  applyToAllEditors();
}

function deactivate() {
  for (const timer of updateTimers.values()) clearTimeout(timer);
  updateTimers.clear();
}

module.exports = { activate, deactivate };
