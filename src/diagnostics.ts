import * as vscode from 'vscode';
import { validateZpl } from './validation';
import { LabelDiagnostic } from './core/diagnostics';
import { validateLabelSource } from './core/validate';
import {
  formatOfDocument,
  getRenderConfig,
  getValidationConfig,
} from './config';
import { isLabelFormatId } from './core/formats';

export { validateZpl };

/**
 * Validates open label documents and publishes diagnostics:
 *   - Syntax: unknown commands, unbalanced label envelopes, parameter counts.
 *   - Semantics: barcode payloads that cannot encode, fields off the label,
 *     bar widths and quiet zones too small to scan.
 */
export class LabelDiagnostics {
  private readonly collection: vscode.DiagnosticCollection;

  constructor() {
    this.collection = vscode.languages.createDiagnosticCollection('labelStudio');
  }

  dispose(): void {
    this.collection.dispose();
  }

  refresh(document: vscode.TextDocument): void {
    if (!isLabelFormatId(document.languageId)) {
      return;
    }
    const config = getValidationConfig();
    if (!config.enable) {
      this.collection.set(document.uri, []);
      return;
    }
    this.collection.set(document.uri, this.validate(document));
  }

  refreshAll(): void {
    for (const document of vscode.workspace.textDocuments) {
      this.refresh(document);
    }
  }

  clear(document: vscode.TextDocument): void {
    this.collection.delete(document.uri);
  }

  private validate(document: vscode.TextDocument): vscode.Diagnostic[] {
    const config = getValidationConfig();
    const render = getRenderConfig();
    const results = validateLabelSource(document.getText(), {
      format: formatOfDocument(document),
      fileName: document.fileName,
      dpmm: render.dpmm,
      widthInches: render.widthInches,
      heightInches: render.heightInches,
      lint: {
        barcodeData: config.barcodeData,
        bounds: config.bounds,
        scannability: config.scannability,
      },
    });
    return results.map((entry) => toVsCodeDiagnostic(document, entry));
  }
}

function toVsCodeDiagnostic(
  document: vscode.TextDocument,
  entry: LabelDiagnostic,
): vscode.Diagnostic {
  const range = new vscode.Range(
    document.positionAt(entry.start),
    document.positionAt(entry.end),
  );
  const diagnostic = new vscode.Diagnostic(
    range,
    entry.message,
    severityOf(entry.severity),
  );
  diagnostic.source = 'Label Studio';
  if (entry.rule) {
    diagnostic.code = entry.rule;
  }
  return diagnostic;
}

function severityOf(
  severity: LabelDiagnostic['severity'],
): vscode.DiagnosticSeverity {
  switch (severity) {
    case 'error':
      return vscode.DiagnosticSeverity.Error;
    case 'warning':
      return vscode.DiagnosticSeverity.Warning;
    default:
      return vscode.DiagnosticSeverity.Information;
  }
}

