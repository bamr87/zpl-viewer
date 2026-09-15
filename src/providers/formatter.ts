import * as vscode from 'vscode';
import { formatLabel } from '../core/pipeline';
import { formatOfDocument, getFormatConfig } from '../config';

/**
 * The edits that lay a label document out with its own language's rules:
 *   - ZPL: optional uppercasing, one command per line, indented label bodies.
 *   - EPL: layout only — command case is significant in EPL2.
 *
 * Exported so `labelStudio.formatDocument` can format the document it was
 * handed instead of delegating to `editor.action.formatDocument`, which acts on
 * whichever code editor has focus — none at all while the preview webview does.
 */
export function labelFormattingEdits(
  document: vscode.TextDocument,
): vscode.TextEdit[] {
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

export class LabelFormatter implements vscode.DocumentFormattingEditProvider {
  provideDocumentFormattingEdits(
    document: vscode.TextDocument,
  ): vscode.ProviderResult<vscode.TextEdit[]> {
    return labelFormattingEdits(document);
  }
}
