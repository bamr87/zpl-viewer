import * as vscode from 'vscode';
import { tokenize } from '../zplParser';

/**
 * Folds each `^XA` … `^XZ` label into a collapsible block.
 */
export class ZplFoldingProvider implements vscode.FoldingRangeProvider {
  provideFoldingRanges(
    document: vscode.TextDocument,
  ): vscode.ProviderResult<vscode.FoldingRange[]> {
    const tokens = tokenize(document.getText());
    const ranges: vscode.FoldingRange[] = [];
    const stack: number[] = [];

    for (const token of tokens) {
      if (token.command === '^XA') {
        stack.push(document.positionAt(token.start).line);
      } else if (token.command === '^XZ' && stack.length > 0) {
        const startLine = stack.pop() as number;
        const endLine = document.positionAt(token.end).line;
        if (endLine > startLine) {
          ranges.push(
            new vscode.FoldingRange(
              startLine,
              endLine,
              vscode.FoldingRangeKind.Region,
            ),
          );
        }
      }
    }
    return ranges;
  }
}
