import * as vscode from 'vscode';
import { tokenize } from '../zplParser';
import { tokenizeEpl } from '../formats/epl/tokenizer';
import { formatOfDocument } from '../config';

/**
 * Folds each label into a collapsible block: `^XA` … `^XZ` in ZPL, and
 * `N` … `P` in EPL.
 */
export class LabelFoldingProvider implements vscode.FoldingRangeProvider {
  provideFoldingRanges(
    document: vscode.TextDocument,
  ): vscode.ProviderResult<vscode.FoldingRange[]> {
    return formatOfDocument(document) === 'epl'
      ? this.foldEpl(document)
      : this.foldZpl(document);
  }

  private foldZpl(document: vscode.TextDocument): vscode.FoldingRange[] {
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

  private foldEpl(document: vscode.TextDocument): vscode.FoldingRange[] {
    const tokens = tokenizeEpl(document.getText());
    const ranges: vscode.FoldingRange[] = [];
    let startLine: number | undefined;

    for (const token of tokens) {
      if (token.name === 'N' && startLine === undefined) {
        startLine = token.line;
      } else if (token.name === 'P' && startLine !== undefined) {
        if (token.line > startLine) {
          ranges.push(
            new vscode.FoldingRange(
              startLine,
              token.line,
              vscode.FoldingRangeKind.Region,
            ),
          );
        }
        startLine = undefined;
      }
    }
    return ranges;
  }
}

