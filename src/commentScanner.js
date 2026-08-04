'use strict';

/**
 * Language-aware comment scanner.
 *
 * Finds every comment range in a source text while skipping string literals,
 * template literals, raw strings and char literals, so that `//` or `/*`
 * sequences inside strings are never treated as comments.
 *
 * Supported languages: JavaScript / TypeScript (incl. JSX/TSX), Rust, Go.
 */

const REGION_START = /#region\b/;
const REGION_END = /#endregion\b/;

const IDENT_CHAR = /[A-Za-z0-9_]/;

const LANGUAGE_CONFIGS = {
  javascript: {
    lineComment: '//',
    blockComment: { open: '/*', close: '*/', nestable: false },
    doubleQuote: true,
    singleQuote: 'string',
    backtick: 'template',
  },
  javascriptreact: null,
  typescript: null,
  typescriptreact: null,
  rust: {
    lineComment: '//',
    blockComment: { open: '/*', close: '*/', nestable: true },
    doubleQuote: true,
    singleQuote: 'rust-char',
    backtick: null,
    rawStrings: true,
  },
  go: {
    lineComment: '//',
    blockComment: { open: '/*', close: '*/', nestable: false },
    doubleQuote: true,
    singleQuote: 'string',
    backtick: 'raw',
  },
};

LANGUAGE_CONFIGS.javascriptreact = LANGUAGE_CONFIGS.javascript;
LANGUAGE_CONFIGS.typescript = LANGUAGE_CONFIGS.javascript;
LANGUAGE_CONFIGS.typescriptreact = LANGUAGE_CONFIGS.javascript;

/**
 * Classify a comment's text as a region marker when it contains
 * `#region` / `#endregion` (for example a block comment such as
 * "slash-star ── #region Rate limit constants ── star-slash").
 * @returns {'start'|'end'|null}
 */
function regionKind(commentText) {
  if (REGION_END.test(commentText)) return 'end';
  if (REGION_START.test(commentText)) return 'start';
  return null;
}

/**
 * Skip a quoted string that uses backslash escapes ("..." or '...').
 * @param {string} text
 * @param {number} i index of the opening quote
 * @param {string} quote
 * @returns {number} index just after the closing quote (or end of text)
 */
function skipQuoted(text, i, quote) {
  i += 1;
  while (i < text.length) {
    const c = text[i];
    if (c === '\\') {
      i += 2;
    } else if (c === quote) {
      return i + 1;
    } else if (c === '\n') {
      // unterminated string literal: bail out at end of line
      return i;
    } else {
      i += 1;
    }
  }
  return i;
}

/**
 * Skip a Rust char literal or lifetime starting at `'`.
 * Distinguishes `'a'` / `'\n'` (char literals) from `'a` (lifetime).
 * @returns {number} index to continue scanning from
 */
function skipRustCharOrLifetime(text, i) {
  const next = text[i + 1];
  if (next === undefined) return i + 1;
  if (next === '\\') {
    // escaped char literal, e.g. '\n' or '\u{1F600}'
    let j = i + 2;
    while (j < text.length && text[j] !== "'" && text[j] !== '\n') {
      if (text[j] === '\\') j += 1;
      j += 1;
    }
    if (text[j] === "'") return j + 1;
    return j;
  }
  if (next !== "'" && text[i + 2] === "'") {
    // simple char literal 'x'
    return i + 3;
  }
  // lifetime such as 'a or 'static — just consume the quote
  return i + 1;
}

/**
 * Skip a JS/TS template literal starting at the opening backtick,
 * including `${...}` interpolations (which may contain nested strings
 * and nested template literals).
 * @returns {number} index just after the closing backtick (or end of text)
 */
function skipTemplateLiteral(text, i) {
  i += 1; // opening backtick
  while (i < text.length) {
    const c = text[i];
    if (c === '\\') {
      i += 2;
    } else if (c === '`') {
      return i + 1;
    } else if (c === '$' && text[i + 1] === '{') {
      i = skipTemplateExpression(text, i + 2);
    } else {
      i += 1;
    }
  }
  return i;
}

/**
 * Skip the expression inside `${...}`, tracking brace depth and nested
 * string/template literals.
 * @param {number} i index just after `${`
 * @returns {number} index just after the matching `}` (or end of text)
 */
function skipTemplateExpression(text, i) {
  let depth = 1;
  while (i < text.length && depth > 0) {
    const c = text[i];
    if (c === '{') {
      depth += 1;
      i += 1;
    } else if (c === '}') {
      depth -= 1;
      i += 1;
    } else if (c === '"' || c === "'") {
      i = skipQuoted(text, i, c);
    } else if (c === '`') {
      i = skipTemplateLiteral(text, i);
    } else {
      i += 1;
    }
  }
  return i;
}

/**
 * Skip a Go raw string literal (backtick-delimited, no escapes).
 * @returns {number} index just after the closing backtick (or end of text)
 */
function skipGoRawString(text, i) {
  const end = text.indexOf('`', i + 1);
  return end === -1 ? text.length : end + 1;
}

/**
 * Try to skip a Rust raw string literal starting at index i:
 * r"...", r#"..."#, br"...", br#"..."#.
 * @returns {number|null} index just after the literal, or null when the
 *   character at i does not start a raw string literal
 */
function skipRustRawString(text, i) {
  const prev = text[i - 1];
  if (prev && IDENT_CHAR.test(prev)) return null;

  let j = i;
  if (text[j] === 'b' && text[j + 1] === 'r') {
    j += 2;
  } else if (text[j] === 'r') {
    j += 1;
  } else {
    return null;
  }

  let hashes = 0;
  while (text[j + hashes] === '#') hashes += 1;
  if (text[j + hashes] !== '"') return null;

  const closeSeq = '"' + '#'.repeat(hashes);
  const found = text.indexOf(closeSeq, j + hashes + 1);
  return found === -1 ? text.length : found + closeSeq.length;
}

/**
 * Find all comment ranges in the given source text.
 *
 * @param {string} text full source text
 * @param {string} languageId VS Code language id
 * @returns {Array<{start:number,end:number,kind:'line'|'block',region:'start'|'end'|null}>}
 *   `start`/`end` are absolute offsets; line comments exclude the trailing
 *   newline; block comments include both delimiters.
 */
function findCommentRanges(text, languageId) {
  const cfg = LANGUAGE_CONFIGS[languageId];
  if (!cfg || typeof text !== 'string' || text.length === 0) return [];

  const results = [];
  const len = text.length;
  const block = cfg.blockComment;
  let i = 0;

  const push = (start, end, kind) => {
    const raw = text.slice(start, end);
    results.push({ start, end, kind, region: regionKind(raw) });
  };

  while (i < len) {
    const c = text[i];

    // Rust raw string literals must be checked before identifiers fall through
    if (cfg.rawStrings && (c === 'r' || c === 'b')) {
      const skipped = skipRustRawString(text, i);
      if (skipped !== null) {
        i = skipped;
        continue;
      }
    }

    // line comment
    if (cfg.lineComment && text.startsWith(cfg.lineComment, i)) {
      const start = i;
      let end = text.indexOf('\n', i);
      if (end === -1) end = len;
      push(start, end, 'line');
      i = end;
      continue;
    }

    // block comment
    if (block && text.startsWith(block.open, i)) {
      const start = i;
      i += block.open.length;
      let depth = 1;
      while (i < len && depth > 0) {
        if (block.nestable && text.startsWith(block.open, i)) {
          depth += 1;
          i += block.open.length;
        } else if (text.startsWith(block.close, i)) {
          depth -= 1;
          i += block.close.length;
        } else {
          i += 1;
        }
      }
      push(start, i, 'block');
      continue;
    }

    // string literals
    if (cfg.doubleQuote && c === '"') {
      i = skipQuoted(text, i, '"');
      continue;
    }
    if (cfg.singleQuote === 'string' && c === "'") {
      i = skipQuoted(text, i, "'");
      continue;
    }
    if (cfg.singleQuote === 'rust-char' && c === "'") {
      i = skipRustCharOrLifetime(text, i);
      continue;
    }
    if (cfg.backtick === 'template' && c === '`') {
      i = skipTemplateLiteral(text, i);
      continue;
    }
    if (cfg.backtick === 'raw' && c === '`') {
      i = skipGoRawString(text, i);
      continue;
    }

    i += 1;
  }

  return results;
}

module.exports = { findCommentRanges, regionKind, LANGUAGE_CONFIGS };
