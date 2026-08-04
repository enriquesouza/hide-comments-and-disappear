'use strict';

/**
 * Zero-dependency tests for src/commentScanner.js.
 *
 * Run from the repo root:
 *   node test/scanner.test.js
 *
 * Exits 0 iff every case passes, 1 otherwise.
 */

const assert = require('node:assert/strict');
const path = require('node:path');

const { findCommentRanges } = require(path.join(__dirname, '..', 'src', 'commentScanner.js'));

// ---------------------------------------------------------------------------
// tiny test runner
// ---------------------------------------------------------------------------

const cases = [];

function test(name, fn) {
  cases.push({ name, fn });
}

/** Map ranges to the source text they matched, for readable assertions. */
function textsOf(text, ranges) {
  return ranges.map((r) => text.slice(r.start, r.end));
}

/** Assert ranges are ordered by start and never overlap. */
function assertOrderedNonOverlapping(ranges) {
  for (let k = 1; k < ranges.length; k += 1) {
    assert.ok(
      ranges[k].start >= ranges[k - 1].end,
      `range ${k} (start ${ranges[k].start}) overlaps or precedes range ${k - 1} (end ${ranges[k - 1].end})`
    );
  }
}

// ---------------------------------------------------------------------------
// JS / TS
// ---------------------------------------------------------------------------

test('simple line comment', () => {
  const text = '// hello';
  assert.deepStrictEqual(findCommentRanges(text, 'javascript'), [
    { start: 0, end: 8, kind: 'line', region: null },
  ]);
});

test('trailing line comment right after code (no spaces)', () => {
  const text = 'x=1;//c';
  const ranges = findCommentRanges(text, 'javascript');
  assert.deepStrictEqual(ranges, [{ start: 4, end: 7, kind: 'line', region: null }]);
  assert.deepStrictEqual(textsOf(text, ranges), ['//c']);
});

test('line comments stop before the newline', () => {
  const text = 'a = 1; // first\nb = 2; // second';
  const ranges = findCommentRanges(text, 'javascript');
  assert.deepStrictEqual(ranges, [
    { start: 7, end: 15, kind: 'line', region: null },
    { start: 23, end: 32, kind: 'line', region: null },
  ]);
  assert.deepStrictEqual(textsOf(text, ranges), ['// first', '// second']);
});

test('inline block comment between code', () => {
  const text = 'a = /* inline */ b;';
  const ranges = findCommentRanges(text, 'javascript');
  assert.deepStrictEqual(ranges, [{ start: 4, end: 16, kind: 'block', region: null }]);
  assert.deepStrictEqual(textsOf(text, ranges), ['/* inline */']);
});

test('JSDoc block comment', () => {
  const text = '/**\n * Docs\n */\nfunction f() {}';
  const ranges = findCommentRanges(text, 'javascript');
  assert.deepStrictEqual(ranges, [{ start: 0, end: 15, kind: 'block', region: null }]);
  assert.deepStrictEqual(textsOf(text, ranges), ['/**\n * Docs\n */']);
});

test('/*! ... */ block comment', () => {
  const text = '/*! license */';
  const ranges = findCommentRanges(text, 'javascript');
  assert.deepStrictEqual(ranges, [{ start: 0, end: 14, kind: 'block', region: null }]);
  assert.deepStrictEqual(textsOf(text, ranges), ['/*! license */']);
});

test('URL inside double-quoted string is not a comment', () => {
  const text = 'const u = "http://example.com"; // real';
  const ranges = findCommentRanges(text, 'javascript');
  assert.deepStrictEqual(ranges, [{ start: 32, end: 39, kind: 'line', region: null }]);
  assert.deepStrictEqual(textsOf(text, ranges), ['// real']);
});

test('// inside single-quoted string is not a comment', () => {
  const text = "const s = 'a // b'; /* c */";
  const ranges = findCommentRanges(text, 'javascript');
  assert.deepStrictEqual(ranges, [{ start: 20, end: 27, kind: 'block', region: null }]);
  assert.deepStrictEqual(textsOf(text, ranges), ['/* c */']);
});

test('escaped quote keeps double-quoted string open', () => {
  // source text: const s = "a\" // still string";
  const text = 'const s = "a\\" // still string";';
  assert.deepStrictEqual(findCommentRanges(text, 'javascript'), []);
});

test('escaped backslash closes string, following // is a comment', () => {
  // source text: const s = "a\\"; // real comment
  const text = 'const s = "a\\\\"; // real comment';
  const ranges = findCommentRanges(text, 'javascript');
  assert.deepStrictEqual(ranges, [{ start: 17, end: 32, kind: 'line', region: null }]);
  assert.deepStrictEqual(textsOf(text, ranges), ['// real comment']);
});

test('// inside template literal is not a comment', () => {
  const text = 'const t = `a // b`; // after';
  const ranges = findCommentRanges(text, 'javascript');
  assert.deepStrictEqual(ranges, [{ start: 20, end: 28, kind: 'line', region: null }]);
  assert.deepStrictEqual(textsOf(text, ranges), ['// after']);
});

test('// inside ${} interpolation (with nested string) is not a comment', () => {
  const text = 'const t = `v=${a + "x//y"} end`; // done';
  const ranges = findCommentRanges(text, 'javascript');
  assert.deepStrictEqual(ranges, [{ start: 33, end: 40, kind: 'line', region: null }]);
  assert.deepStrictEqual(textsOf(text, ranges), ['// done']);
});

test('nested backticks inside ${} are skipped', () => {
  const text = 'const t = `outer ${`inner // not comment`} rest // still not`; // real';
  const ranges = findCommentRanges(text, 'javascript');
  assert.deepStrictEqual(ranges, [{ start: 63, end: 70, kind: 'line', region: null }]);
  assert.deepStrictEqual(textsOf(text, ranges), ['// real']);
});

test('js block comments do not nest', () => {
  const text = '/* a /* b */ c */';
  const ranges = findCommentRanges(text, 'javascript');
  assert.deepStrictEqual(ranges, [{ start: 0, end: 12, kind: 'block', region: null }]);
  assert.deepStrictEqual(textsOf(text, ranges), ['/* a /* b */']);
});

test('unterminated block comment at EOF spans to end of text', () => {
  const text = 'a(); /* never closed';
  const ranges = findCommentRanges(text, 'javascript');
  assert.deepStrictEqual(ranges, [{ start: 5, end: 20, kind: 'block', region: null }]);
  assert.deepStrictEqual(textsOf(text, ranges), ['/* never closed']);
  assert.equal(ranges[0].end, text.length);
});

test('unterminated line comment at EOF spans to end of text', () => {
  const text = 'x = 1; // tail without newline';
  const ranges = findCommentRanges(text, 'javascript');
  assert.deepStrictEqual(ranges, [{ start: 7, end: 30, kind: 'line', region: null }]);
  assert.equal(ranges[0].end, text.length);
});

test('js/ts family language ids share the same rules', () => {
  const text = 'let s = "a // b"; // c';
  const expected = [{ start: 18, end: 22, kind: 'line', region: null }];
  for (const id of ['javascript', 'javascriptreact', 'typescript', 'typescriptreact']) {
    assert.deepStrictEqual(findCommentRanges(text, id), expected, `language id ${id}`);
  }
});

// ---------------------------------------------------------------------------
// region classification
// ---------------------------------------------------------------------------

test('#region / #endregion in block comments', () => {
  const text = '/* #region Constants */\nconst x = 1;\n/* #endregion */';
  const ranges = findCommentRanges(text, 'javascript');
  assert.deepStrictEqual(ranges, [
    { start: 0, end: 23, kind: 'block', region: 'start' },
    { start: 37, end: 53, kind: 'block', region: 'end' },
  ]);
  assert.deepStrictEqual(textsOf(text, ranges), ['/* #region Constants */', '/* #endregion */']);
});

test('#endregion in line comment is classified end, not start', () => {
  const text = '// #region top\nlet a = 1; // #endregion bottom';
  const ranges = findCommentRanges(text, 'javascript');
  assert.equal(ranges.length, 2);
  assert.equal(ranges[0].region, 'start');
  assert.equal(ranges[1].region, 'end');
  assert.deepStrictEqual(ranges[1], { start: 26, end: 46, kind: 'line', region: 'end' });
  assert.equal(text.slice(ranges[1].start, ranges[1].end), '// #endregion bottom');
});

test('region markers without leading space', () => {
  const text = '//#region tight\n//#endregion tight';
  const ranges = findCommentRanges(text, 'javascript');
  assert.deepStrictEqual(ranges, [
    { start: 0, end: 15, kind: 'line', region: 'start' },
    { start: 16, end: 34, kind: 'line', region: 'end' },
  ]);
});

// ---------------------------------------------------------------------------
// Rust
// ---------------------------------------------------------------------------

test('rust nested block comments are one comment', () => {
  const text = '/* a /* b */ c */';
  const ranges = findCommentRanges(text, 'rust');
  assert.deepStrictEqual(ranges, [{ start: 0, end: 17, kind: 'block', region: null }]);
  assert.deepStrictEqual(textsOf(text, ranges), ['/* a /* b */ c */']);
});

test('rust unterminated nested block comment at EOF', () => {
  const text = '/* a /* b';
  const ranges = findCommentRanges(text, 'rust');
  assert.deepStrictEqual(ranges, [{ start: 0, end: 9, kind: 'block', region: null }]);
  assert.equal(ranges[0].end, text.length);
});

test('rust /// and //! doc comments are line comments', () => {
  const text = '/// doc comment\n//! module doc';
  const ranges = findCommentRanges(text, 'rust');
  assert.deepStrictEqual(ranges, [
    { start: 0, end: 15, kind: 'line', region: null },
    { start: 16, end: 30, kind: 'line', region: null },
  ]);
  assert.deepStrictEqual(textsOf(text, ranges), ['/// doc comment', '//! module doc']);
});

test('rust lifetimes and char literals produce no comments', () => {
  const text = "fn f<'a>(s: &'a str, t: &'static str) -> char { '/' }";
  assert.deepStrictEqual(findCommentRanges(text, 'rust'), []);
});

test("rust escaped char literal '\\n' then trailing comment", () => {
  // source text: let c = '\n'; // x
  const text = "let c = '\\n'; // x";
  const ranges = findCommentRanges(text, 'rust');
  assert.deepStrictEqual(ranges, [{ start: 14, end: 18, kind: 'line', region: null }]);
  assert.deepStrictEqual(textsOf(text, ranges), ['// x']);
});

test('rust raw strings r#"..."#, br"..." and r"..." are skipped', () => {
  const prefix = [
    'let a = r#"a // b"#;',
    'let b = br"c /* d */ e";',
    'let c = r"f // g";',
    '',
  ].join('\n');
  const text = prefix + '// tail';
  const ranges = findCommentRanges(text, 'rust');
  assert.deepStrictEqual(ranges, [
    { start: prefix.length, end: text.length, kind: 'line', region: null },
  ]);
  assert.deepStrictEqual(textsOf(text, ranges), ['// tail']);
});

// ---------------------------------------------------------------------------
// Go
// ---------------------------------------------------------------------------

test('go raw string with // and /* inside', () => {
  const text = 'const s = `http://x /* not */`\n// after';
  const ranges = findCommentRanges(text, 'go');
  assert.deepStrictEqual(ranges, [{ start: 31, end: 39, kind: 'line', region: null }]);
  assert.deepStrictEqual(textsOf(text, ranges), ['// after']);
});

test("go rune literal '/' is skipped, trailing comment found", () => {
  const text = "var r = '/' // slash";
  const ranges = findCommentRanges(text, 'go');
  assert.deepStrictEqual(ranges, [{ start: 12, end: 20, kind: 'line', region: null }]);
  assert.deepStrictEqual(textsOf(text, ranges), ['// slash']);
});

// ---------------------------------------------------------------------------
// invalid input / unsupported languages
// ---------------------------------------------------------------------------

test('unsupported language ids return []', () => {
  for (const id of ['python', 'html', '']) {
    assert.deepStrictEqual(findCommentRanges('// nope /* nothing */', id), [], `language id '${id}'`);
  }
});

test('empty or invalid input returns []', () => {
  assert.deepStrictEqual(findCommentRanges('', 'javascript'), []);
  assert.deepStrictEqual(findCommentRanges(null, 'javascript'), []);
  assert.deepStrictEqual(findCommentRanges(undefined, 'rust'), []);
  assert.deepStrictEqual(findCommentRanges(123, 'go'), []);
});

// ---------------------------------------------------------------------------
// mixed document: ordering, non-overlap, kinds, regions
// ---------------------------------------------------------------------------

test('mixed document: ordered, non-overlapping, correct kinds and regions', () => {
  const docLines = [
    'const url = "http://a"; // one',
    'let b = `t // x ${ "s // y" }`;',
    '/* two */ code(); /* three',
    'still block */',
    '// four #region R',
  ];
  const text = docLines.join('\n');
  const lineStarts = [];
  let p = 0;
  for (const l of docLines) {
    lineStarts.push(p);
    p += l.length + 1;
  }

  const ranges = findCommentRanges(text, 'javascript');

  assert.equal(ranges.length, 4);
  assertOrderedNonOverlapping(ranges);
  assert.deepStrictEqual(ranges, [
    { start: lineStarts[0] + 24, end: lineStarts[0] + 30, kind: 'line', region: null },
    { start: lineStarts[2], end: lineStarts[2] + 9, kind: 'block', region: null },
    { start: lineStarts[2] + 18, end: lineStarts[2] + 41, kind: 'block', region: null },
    { start: lineStarts[4], end: lineStarts[4] + 17, kind: 'line', region: 'start' },
  ]);
  assert.deepStrictEqual(textsOf(text, ranges), [
    '// one',
    '/* two */',
    '/* three\nstill block */',
    '// four #region R',
  ]);
});

// ---------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

for (const { name, fn } of cases) {
  try {
    fn();
    console.log(`PASS ${name}`);
    passed += 1;
  } catch (err) {
    failed += 1;
    console.log(`FAIL ${name}`);
    const message = err && err.message ? String(err.message) : String(err);
    for (const line of message.split('\n')) {
      console.log(`       ${line}`);
    }
  }
}

console.log(`\n${passed}/${cases.length} cases passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
