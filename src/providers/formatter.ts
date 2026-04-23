import * as vscode from 'vscode';
import { formatZpl } from '../formatting';

/**
 * Formats a ZPL document:
 *   - Optionally uppercases command names.
 *   - Optionally places each command on its own line.
 *   - Indents everything between `^XA` and `^XZ` by two spaces.
 */
export class ZplFormatter
  implements vscode.DocumentFormattingEditProvider
{
  provideDocumentFormattingEdits(
    document: vscode.TextDocument,
  ): vscode.ProviderResult<vscode.TextEdit[]> {
    const config = vscode.workspace.getConfiguration('zplViewer.format');
    const uppercase = config.get<boolean>('uppercaseCommands', true);
    const oneCommandPerLine = config.get<boolean>('oneCommandPerLine', true);

    const original = document.getText();
    const formatted = formatZpl(original, { uppercase, oneCommandPerLine });
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

