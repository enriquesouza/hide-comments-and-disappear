'use strict';

const vscode = require('vscode');
const { analyzeCommentLines } = require('./commentLines');

// Folding provider that makes comments collapsible:
//
// - Multi-line block comments fold like VS Code's native
//   "Fold All Block Comments" behaviour.
// - `#region` / `#endregion` comment markers (block style like
//   "/* ── #region Rate limit constants ── */" or line style like
//   "// #region") fold the code between the markers, keeping the
//   `#endregion` marker visible as the fold handle.
// - Runs of comment-only lines fold into the line above them, so hiding
//   comments leaves no empty lines behind.
class CommentFoldingProvider {
  provideFoldingRanges(document) {
    const info = analyzeCommentLines(document.getText(), document.languageId);
    const ranges = [];
    const regionStack = [];

    for (const comment of info.comments) {
      const startLine = document.positionAt(comment.start).line;
      const endLine = document.positionAt(Math.max(comment.start, comment.end - 1)).line;

      if (comment.region === 'start') {
        regionStack.push(startLine);
      } else if (comment.region === 'end') {
        const openLine = regionStack.pop();
        if (openLine !== undefined && startLine > openLine) {
          ranges.push(new vscode.FoldingRange(openLine, startLine - 1, vscode.FoldingRangeKind.Region));
        }
      } else if (comment.kind === 'block' && endLine > startLine) {
        // skip block comments fully inside a comment-only run: the run fold
        // already covers them and would otherwise win as the innermost fold
        const coveredByRun = info.runs.some((run) => startLine >= run.startLine && endLine <= run.endLine);
        if (!coveredByRun) {
          ranges.push(new vscode.FoldingRange(startLine, endLine, vscode.FoldingRangeKind.Comment));
        }
      }
    }

    for (const run of info.runs) {
      ranges.push(new vscode.FoldingRange(run.foldStart, run.endLine, vscode.FoldingRangeKind.Comment));
    }

    return ranges;
  }
}

module.exports = { CommentFoldingProvider };
