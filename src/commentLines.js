'use strict';

/**
 * Line-level analysis on top of the comment scanner.
 *
 * Determines which lines contain nothing but comments (plus whitespace) and
 * groups them into consecutive runs, so that when comments are hidden the
 * extension can fold those runs away instead of leaving empty lines behind.
 *
 * Lines containing `#region` / `#endregion` markers are never part of a run:
 * they must stay visible as fold handles.
 */

const { findCommentRanges } = require('./commentScanner');

/**
 * Binary search: index of the last line start that is <= offset.
 * @param {number[]} lineStarts
 * @param {number} offset
 * @returns {number}
 */
function lineIndexAt(lineStarts, offset) {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Analyze comment usage per line.
 *
 * @param {string} text full source text
 * @param {string} languageId VS Code language id
 * @returns {{
 *   comments: Array<{start:number,end:number,kind:'line'|'block',region:'start'|'end'|null}>,
 *   lineStates: Array<{hasComment:boolean,commentOnly:boolean,region:boolean,blank:boolean}>,
 *   runs: Array<{startLine:number,endLine:number,foldStart:number,triggerLine:number}>,
 *   blockFolds: Array<{startLine:number,endLine:number,triggerLine:number}>
 * }}
 *   Each run is a maximal span of comment-only lines (blank lines between
 *   comment-only lines are absorbed). Folding the range
 *   (foldStart, endLine) hides every line of the run: `foldStart` is the
 *   line just above the run, or line 0 for runs at the top of the file
 *   (where the first line cannot be hidden). `triggerLine` is the line to
 *   pass to the editor fold/unfold commands.
 *   `blockFolds` are the multi-line block comments that do not overlap any
 *   run (runs already cover those), each foldable from its start line.
 */
function analyzeCommentLines(text, languageId) {
  const comments = findCommentRanges(text, languageId);

  const lineStarts = [0];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\n') lineStarts.push(i + 1);
  }
  const lineCount = lineStarts.length;

  const lineStates = [];
  for (let l = 0; l < lineCount; l += 1) {
    const end = l + 1 < lineCount ? lineStarts[l + 1] - 1 : text.length;
    lineStates.push({
      hasComment: false,
      commentOnly: false,
      region: false,
      blank: text.slice(lineStarts[l], end).trim() === '',
    });
  }

  if (comments.length === 0) return { comments, lineStates, runs: [], blockFolds: [] };

  for (const comment of comments) {
    const startLine = lineIndexAt(lineStarts, comment.start);
    const endLine = lineIndexAt(lineStarts, Math.max(comment.start, comment.end - 1));
    for (let l = startLine; l <= endLine; l += 1) {
      lineStates[l].hasComment = true;
      if (comment.region) lineStates[l].region = true;
    }
  }

  // A line is comment-only when it has at least one comment, no region
  // marker, and every character outside the comment spans is whitespace.
  let commentCursor = 0;
  for (let l = 0; l < lineCount; l += 1) {
    const state = lineStates[l];
    if (!state.hasComment || state.region) continue;

    const lineStart = lineStarts[l];
    const lineEnd = l + 1 < lineCount ? lineStarts[l + 1] - 1 : text.length;

    while (commentCursor < comments.length && comments[commentCursor].end <= lineStart) {
      commentCursor += 1;
    }

    let cursor = lineStart;
    let onlyComments = true;
    for (let k = commentCursor; k < comments.length && comments[k].start < lineEnd; k += 1) {
      const comment = comments[k];
      const coverStart = Math.max(comment.start, lineStart);
      const coverEnd = Math.min(comment.end, lineEnd);
      if (coverStart > cursor && text.slice(cursor, coverStart).trim() !== '') {
        onlyComments = false;
        break;
      }
      if (coverEnd > cursor) cursor = coverEnd;
    }
    if (onlyComments && cursor < lineEnd && text.slice(cursor, lineEnd).trim() !== '') {
      onlyComments = false;
    }
    state.commentOnly = onlyComments;
  }

  // Group consecutive comment-only lines into runs. Blank lines are absorbed
  // into a run only when comment-only lines follow them.
  const runs = [];
  let i = 0;
  while (i < lineCount) {
    if (!lineStates[i].commentOnly) {
      i += 1;
      continue;
    }

    let end = i;
    let probe = i + 1;
    while (probe < lineCount) {
      if (lineStates[probe].commentOnly) {
        end = probe;
        probe += 1;
      } else if (lineStates[probe].blank) {
        let after = probe;
        while (after < lineCount && lineStates[after].blank) after += 1;
        if (after < lineCount && lineStates[after].commentOnly) {
          end = after;
          probe = after + 1;
        } else {
          break;
        }
      } else {
        break;
      }
    }

    const foldStart = i > 0 ? i - 1 : 0;
    if (end > foldStart) {
      runs.push({ startLine: i, endLine: end, foldStart, triggerLine: foldStart });
    }
    i = end + 1;
  }

  // Foldable multi-line block comments, except those overlapping a run:
  // the run fold already covers them, and a nested fold inside a run fold
  // would be collapsed first by the editor, leaving part of the run visible.
  const blockFolds = [];
  for (const comment of comments) {
    if (comment.kind !== 'block' || comment.region) continue;
    const startLine = lineIndexAt(lineStarts, comment.start);
    const endLine = lineIndexAt(lineStarts, Math.max(comment.start, comment.end - 1));
    if (endLine <= startLine) continue;
    const overlapsRun = runs.some((run) => startLine <= run.endLine && endLine >= run.startLine);
    if (!overlapsRun) {
      blockFolds.push({ startLine, endLine, triggerLine: startLine });
    }
  }

  return { comments, lineStates, runs, blockFolds };
}

module.exports = { analyzeCommentLines };
