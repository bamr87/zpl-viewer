import * as vscode from 'vscode';
import { validateZpl } from './validation';

export { validateZpl };

/**
 * Validates a ZPL document and produces diagnostics:
 *   - Unknown commands
 *   - Missing `^XA` or `^XZ`
 *   - Unclosed `^FD` (no `^FS` before label end)
 *   - Wrong parameter counts (best-effort heuristic)
 */
export class ZplDiagnostics {
  private readonly collection: vscode.DiagnosticCollection;

  constructor() {
    this.collection = vscode.languages.createDiagnosticCollection('zpl');
  }

  dispose(): void {
    this.collection.dispose();
  }

  refresh(document: vscode.TextDocument): void {
    if (document.languageId !== 'zpl') {
      return;
    }
    const enabled = vscode.workspace
      .getConfiguration('zplViewer.validation')
      .get<boolean>('enable', true);
    if (!enabled) {
      this.collection.set(document.uri, []);
      return;
    }
    this.collection.set(document.uri, this.validate(document));
  }

  clear(document: vscode.TextDocument): void {
    this.collection.delete(document.uri);
  }

  private validate(document: vscode.TextDocument): vscode.Diagnostic[] {
    const results = validateZpl(document.getText());
    return results.map((entry) => {
      const range = new vscode.Range(
        document.positionAt(entry.start),
        document.positionAt(entry.end),
      );
      return new vscode.Diagnostic(
        range,
        entry.message,
        entry.severity === 'warning'
          ? vscode.DiagnosticSeverity.Warning
          : vscode.DiagnosticSeverity.Information,
      );
    });
  }
}
