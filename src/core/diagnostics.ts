/**
 * Format-neutral diagnostic shape. Every validator (ZPL, EPL, barcode data,
 * label analysis) produces these; the VS Code layer is the only place that
 * knows about `vscode.Diagnostic`.
 */

export type DiagnosticSeverityName = 'error' | 'warning' | 'information';

export interface LabelDiagnostic {
  /** Character offset of the start of the offending text. */
  start: number;
  /** Character offset just past the offending text. */
  end: number;
  message: string;
  severity: DiagnosticSeverityName;
  /** Stable rule id, e.g. `barcode.check-digit`. */
  rule?: string;
}

export function severityRank(severity: DiagnosticSeverityName): number {
  switch (severity) {
    case 'error':
      return 2;
    case 'warning':
      return 1;
    default:
      return 0;
  }
}

export function countBySeverity(
  diagnostics: LabelDiagnostic[],
): Record<DiagnosticSeverityName, number> {
  const counts: Record<DiagnosticSeverityName, number> = {
    error: 0,
    warning: 0,
    information: 0,
  };
  for (const diagnostic of diagnostics) {
    counts[diagnostic.severity] += 1;
  }
  return counts;
}
