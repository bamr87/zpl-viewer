import * as vscode from 'vscode';
import { formatLabel } from '../core/pipeline';
import { formatOfDocument, getFormatConfig } from '../config';

/**
 * Formats a label document with its own language's rules:
 *   - ZPL: optional uppercasing, one command per line, indented label bodies.
 *   - EPL: layout only — command case is significant in EPL2.
 */
export class LabelFormatter implements vscode.DocumentFormattingEditProvider {
  provideDocumentFormattingEdits(
    document: vscode.TextDocument,
  ): vscode.ProviderResult<vscode.TextEdit[]> {
    const config = getFormatConfig();
    const original = document.getText();
    const formatted = formatLabel(original, formatOfDocument(document), {
      uppercaseCommands: config.uppercaseCommands,
      oneCommandPerLine: config.oneCommandPerLine,
    });
    if (formatted === original) {
      return [];
    }

    const fullRange = new vscode.Range(
      document.positionAt(0),
      document.positionAt(original.length),
    );
    return [vscode.TextEdit.replace(fullRange, formatted)];
  }
}

