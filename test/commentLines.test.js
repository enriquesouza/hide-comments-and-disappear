'use strict';

/**
 * Zero-dependency tests for src/commentLines.js.
 *
 * Run from the repo root:
 *   node test/commentLines.test.js
 *
 * Exits 0 iff every case passes, 1 otherwise.
 */

const assert = require('node:assert/strict');
const path = require('node:path');

const { analyzeCommentLines } = require(path.join(__dirname, '..', 'src', 'commentLines.js'));

// ---------------------------------------------------------------------------
// tiny test runner (same style as scanner.test.js)
// ---------------------------------------------------------------------------

const cases = [];

function test(name, fn) {
  cases.push({ name, fn });
}

/** Shorthand: only the runs of an analysis. */
function runsOf(text, languageId) {
  return analyzeCommentLines(text, languageId).runs;
}

/** Shorthand: commentOnly flags per line. */
function commentOnlyFlags(text, languageId) {
  return analyzeCommentLines(text, languageId).lineStates.map((s) => s.commentOnly);
}

// ---------------------------------------------------------------------------
// line classification
// ---------------------------------------------------------------------------

test('line with only a line comment is comment-only', () => {
  const text = 'const a = 1;\n// just a note\nconst b = 2;';
  assert.deepStrictEqual(commentOnlyFlags(text, 'javascript'), [false, true, false]);
});

test('indented comment with trailing spaces is comment-only', () => {
  const text = 'fn main() {\n    // indented note   \n}';
  assert.deepStrictEqual(commentOnlyFlags(text, 'rust'), [false, true, false]);
});

test('inline comment after code is NOT comment-only', () => {
  const text = 'const a = 1; // trailing\nconst b = 2;';
  assert.deepStrictEqual(commentOnlyFlags(text, 'javascript'), [false, false]);
});

test('code before a block comment on the same line is NOT comment-only', () => {
  const text = 'x = 1 /* note */;\ny = 2;';
  assert.deepStrictEqual(commentOnlyFlags(text, 'javascript'), [false, false]);
});

test('line inside a multi-line block comment is comment-only', () => {
  const text = 'a();\n/*\n middle\n*/\nb();';
  assert.deepStrictEqual(commentOnlyFlags(text, 'javascript'), [false, true, true, true, false]);
});

test('string containing // does not make a line comment-only', () => {
  const text = 'const url = "https://example.com";\n// real comment';
  assert.deepStrictEqual(commentOnlyFlags(text, 'javascript'), [false, true]);
});

test('blank lines are not comment-only', () => {
  const text = '// c1\n\n// c2';
  const states = analyzeCommentLines(text, 'javascript').lineStates;
  assert.deepStrictEqual(states.map((s) => s.commentOnly), [true, false, true]);
  assert.equal(states[1].blank, true);
});

test('region marker lines are never comment-only', () => {
  const text = '// #region Things\n// inside\n// #endregion';
  const states = analyzeCommentLines(text, 'javascript').lineStates;
  assert.deepStrictEqual(states.map((s) => s.commentOnly), [false, true, false]);
  assert.equal(states[0].region, true);
  assert.equal(states[2].region, true);
});

test('block-style region marker lines are never comment-only', () => {
  const text = '/* ── #region Rate limit constants ── */\nconst A = 1;\n/* ── #endregion ── */';
  const states = analyzeCommentLines(text, 'javascript').lineStates;
  assert.deepStrictEqual(states.map((s) => s.commentOnly), [false, false, false]);
});

// ---------------------------------------------------------------------------
// runs
// ---------------------------------------------------------------------------

test('run between code folds into the line above', () => {
  const text = 'const a = 1;\n// c1\n// c2\nconst b = 2;';
  assert.deepStrictEqual(runsOf(text, 'javascript'), [
    { startLine: 1, endLine: 2, foldStart: 0, triggerLine: 0 },
  ]);
});

test('single comment-only line folds into the line above', () => {
  const text = 'const a = 1;\n// only\nconst b = 2;';
  assert.deepStrictEqual(runsOf(text, 'javascript'), [
    { startLine: 1, endLine: 1, foldStart: 0, triggerLine: 0 },
  ]);
});

test('run at the top of the file anchors on line 0', () => {
  const text = '// header note\n// more header\nconst a = 1;';
  assert.deepStrictEqual(runsOf(text, 'javascript'), [
    { startLine: 0, endLine: 1, foldStart: 0, triggerLine: 0 },
  ]);
});

test('single comment-only line at the very top cannot fold', () => {
  const text = '// only line comment\nconst a = 1;';
  assert.deepStrictEqual(runsOf(text, 'javascript'), []);
});

test('run at the end of the file folds into the line above', () => {
  const text = 'const a = 1;\n// trailing 1\n// trailing 2';
  assert.deepStrictEqual(runsOf(text, 'javascript'), [
    { startLine: 1, endLine: 2, foldStart: 0, triggerLine: 0 },
  ]);
});

test('blank lines between comment lines are absorbed into the run', () => {
  const text = 'code();\n// c1\n\n// c2\nmore();';
  assert.deepStrictEqual(runsOf(text, 'javascript'), [
    { startLine: 1, endLine: 3, foldStart: 0, triggerLine: 0 },
  ]);
});

test('trailing blank lines after a run are not absorbed', () => {
  const text = 'code();\n// c1\n\nmore();';
  assert.deepStrictEqual(runsOf(text, 'javascript'), [
    { startLine: 1, endLine: 1, foldStart: 0, triggerLine: 0 },
  ]);
});

test('multi-line block comment alone on its lines forms one run', () => {
  const text = 'a();\n/*\n block\n comment\n*/\nb();';
  assert.deepStrictEqual(runsOf(text, 'javascript'), [
    { startLine: 1, endLine: 4, foldStart: 0, triggerLine: 0 },
  ]);
});

test('two separate runs are reported separately', () => {
  const text = 'a();\n// run 1\nb();\n// run 2\n// run 2b\nc();';
  assert.deepStrictEqual(runsOf(text, 'javascript'), [
    { startLine: 1, endLine: 1, foldStart: 0, triggerLine: 0 },
    { startLine: 3, endLine: 4, foldStart: 2, triggerLine: 2 },
  ]);
});

test('region markers split runs and stay out of them', () => {
  const text = '// #region Things\n// inside a\n// inside b\n// #endregion';
  assert.deepStrictEqual(runsOf(text, 'javascript'), [
    { startLine: 1, endLine: 2, foldStart: 0, triggerLine: 0 },
  ]);
});

test('no comments means no runs', () => {
  const text = 'const a = 1;\n\nconst b = 2;';
  assert.deepStrictEqual(runsOf(text, 'javascript'), []);
});

test('only inline comments means no runs', () => {
  const text = 'const a = 1; // x\nconst b = 2; // y';
  assert.deepStrictEqual(runsOf(text, 'javascript'), []);
});

// ---------------------------------------------------------------------------
// other languages
// ---------------------------------------------------------------------------

test('go: run detection with raw strings present', () => {
  const text = 'var s = `// not a comment`\n// real 1\n// real 2\nvar t = 1';
  assert.deepStrictEqual(runsOf(text, 'go'), [
    { startLine: 1, endLine: 2, foldStart: 0, triggerLine: 0 },
  ]);
});

test('rust: doc comments and nested blocks form runs', () => {
  const text = 'fn main() {\n    /// doc line\n    //! inner doc\n    let x = 1;\n}';
  assert.deepStrictEqual(runsOf(text, 'rust'), [
    { startLine: 1, endLine: 2, foldStart: 0, triggerLine: 0 },
  ]);
});

test('rust: lifetimes do not confuse line classification', () => {
  const text = "fn f<'a>(x: &'a str) {}\n// note\nlet y = '/';";
  assert.deepStrictEqual(runsOf(text, 'rust'), [
    { startLine: 1, endLine: 1, foldStart: 0, triggerLine: 0 },
  ]);
});

test('typescript: template literals do not create false comment-only lines', () => {
  const text = 'const s = `\n// looks like a comment\n`;\n// real';
  assert.deepStrictEqual(commentOnlyFlags(text, 'typescript'), [false, false, false, true]);
});

// ---------------------------------------------------------------------------
// block folds (multi-line block comments not covered by a run)
// ---------------------------------------------------------------------------

/** Shorthand: only the block folds of an analysis. */
function blockFoldsOf(text, languageId) {
  return analyzeCommentLines(text, languageId).blockFolds;
}

test('multi-line block comment whose lines all contain code is a block fold', () => {
  // both lines have code outside the comment, so no comment-only run exists
  const text = 'x = /* a\n b */ y;';
  assert.deepStrictEqual(blockFoldsOf(text, 'javascript'), [
    { startLine: 0, endLine: 1, triggerLine: 0 },
  ]);
});

test('standalone multi-line block comment becomes a run, not a block fold', () => {
  const text = 'a();\n/*\n block\n*/\nb();';
  assert.deepStrictEqual(blockFoldsOf(text, 'javascript'), []);
});

test('block comment starting on a code line and running into a run is suppressed', () => {
  const text = 'x; /* c1\n  c2\n  c3 */\ny;';
  // lines 1-2 are comment-only, so the run covers them and the block fold
  // (which would nest inside the run fold) must be suppressed
  const info = analyzeCommentLines(text, 'javascript');
  assert.deepStrictEqual(info.runs, [{ startLine: 1, endLine: 2, foldStart: 0, triggerLine: 0 }]);
  assert.deepStrictEqual(info.blockFolds, []);
});

test('single-line block comment produces no block fold', () => {
  const text = 'a(); /* inline */\nb();';
  assert.deepStrictEqual(blockFoldsOf(text, 'javascript'), []);
});

test('region block comments produce no block fold', () => {
  const text = '/* ── #region A ── */\nconst x = 1;\n/* ── #endregion ── */';
  assert.deepStrictEqual(blockFoldsOf(text, 'javascript'), []);
});

test('rust nested block comment counts as one block fold when lines carry code', () => {
  const text = 'let a = 1; /* outer /* inner */\n still outer */ + 2;\nlet b = 3;';
  assert.deepStrictEqual(blockFoldsOf(text, 'rust'), [
    { startLine: 0, endLine: 1, triggerLine: 0 },
  ]);
});

// ---------------------------------------------------------------------------
// region pairs and labels
// ---------------------------------------------------------------------------

/** Shorthand: only the region pairs of an analysis. */
function regionPairsOf(text, languageId) {
  return analyzeCommentLines(text, languageId).regionPairs;
}

test('block-style region pair with box-drawing decoration extracts the label', () => {
  const text = '/* ── #region Tests ── */\n#[cfg(test)]\nmod tests {}\n/* ── #endregion ── */';
  assert.deepStrictEqual(regionPairsOf(text, 'rust'), [
    { startLine: 0, endLine: 3, label: 'Tests' },
  ]);
});

test('line-style region pair extracts the full label', () => {
  const text = '// #region Rate limit constants\nconst A = 1;\n// #endregion';
  assert.deepStrictEqual(regionPairsOf(text, 'javascript'), [
    { startLine: 0, endLine: 2, label: 'Rate limit constants' },
  ]);
});

test('region without a label yields an empty label', () => {
  const text = '/* #region */\nx();\n/* #endregion */';
  assert.deepStrictEqual(regionPairsOf(text, 'javascript'), [
    { startLine: 0, endLine: 2, label: '' },
  ]);
});

test('nested regions pair innermost first', () => {
  const text = '// #region Outer\n// #region Inner\nx();\n// #endregion\ny();\n// #endregion';
  assert.deepStrictEqual(regionPairsOf(text, 'javascript'), [
    { startLine: 1, endLine: 3, label: 'Inner' },
    { startLine: 0, endLine: 5, label: 'Outer' },
  ]);
});

test('unmatched region markers produce no pairs', () => {
  assert.deepStrictEqual(regionPairsOf('// #region Orphan\ncode();', 'javascript'), []);
  assert.deepStrictEqual(regionPairsOf('code();\n// #endregion', 'javascript'), []);
});

test('region markers on the same line produce no pair', () => {
  const text = '/* #region X */ code(); /* #endregion */';
  assert.deepStrictEqual(regionPairsOf(text, 'javascript'), []);
});

test('go line-style region pairs are detected', () => {
  const text = '// #region Demo helpers\nfunc f() {}\n// #endregion';
  assert.deepStrictEqual(regionPairsOf(text, 'go'), [
    { startLine: 0, endLine: 2, label: 'Demo helpers' },
  ]);
});

// ---------------------------------------------------------------------------
// runner
// ---------------------------------------------------------------------------

let failed = 0;
for (const { name, fn } of cases) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL ${name}`);
    console.log(`  ${error.message.split('\n').join('\n  ')}`);
  }
}

console.log(`\n${cases.length - failed}/${cases.length} cases passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
