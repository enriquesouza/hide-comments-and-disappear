'use strict';

const vscode = require('vscode');
const { findCommentRanges } = require('./commentScanner');

// Folding provider that makes comments collapsible:
//
// - Multi-line block comments fold like VS Code's native
//   "Fold All Block Comments" behaviour.
// - `#region` / `#endregion` comment markers (block style like
//   "/* ── #region Rate limit constants ── */" or line style like
//   "// #region") fold the code between the markers, keeping the
//   `#endregion` marker visible as the fold handle.
class CommentFoldingProvider {
  provideFoldingRanges(document) {
    const comments = findCommentRanges(document.getText(), document.languageId);
    const ranges = [];
    const regionStack = [];

    for (const comment of comments) {
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
        ranges.push(new vscode.FoldingRange(startLine, endLine, vscode.FoldingRangeKind.Comment));
      }
    }

    return ranges;
  }
}

module.exports = { CommentFoldingProvider };
