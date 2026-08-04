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

    // #region/#endregion pairs fold the code between the markers, keeping
    // the #endregion marker visible as the fold handle
    for (const pair of info.regionPairs) {
      if (pair.endLine - 1 > pair.startLine) {
        ranges.push(new vscode.FoldingRange(pair.startLine, pair.endLine - 1, vscode.FoldingRangeKind.Region));
      }
    }

    // multi-line block comments that are not covered by a comment-only run
    for (const fold of info.blockFolds) {
      ranges.push(new vscode.FoldingRange(fold.startLine, fold.endLine, vscode.FoldingRangeKind.Comment));
    }

    // runs of comment-only lines fold into the line above them
    for (const run of info.runs) {
      ranges.push(new vscode.FoldingRange(run.foldStart, run.endLine, vscode.FoldingRangeKind.Comment));
    }

    return ranges;
  }
}

module.exports = { CommentFoldingProvider };
