/**
 * Renders a {@link LabelAnalysis} as Markdown. The analyze command opens the
 * result as a Markdown document, which VS Code can preview, save next to the
 * label, or paste into a ticket.
 */

import { LabelDiagnostic, countBySeverity } from '../core/diagnostics';
import { describeDensity } from '../core/units';
import { LabelAnalysis, PageMetrics } from './metrics';

function opSummary(page: PageMetrics): string {
  const entries = Object.entries(page.opCounts).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) {
    return '_empty label_';
  }
  return entries.map(([type, count]) => `${count} ${type}`).join(', ');
}

function coverageNote(percent: number): string {
  if (percent >= 60) {
    return 'very heavy — expect slower print speeds and increased head wear';
  }
  if (percent >= 30) {
    return 'heavy';
  }
  if (percent >= 10) {
    return 'typical';
  }
  return 'light';
}

export function renderAnalysisMarkdown(
  analysis: LabelAnalysis,
  diagnostics: LabelDiagnostic[],
  documentName: string,
): string {
  const counts = countBySeverity(diagnostics);
  const lines: string[] = [
    `# Label analysis: ${documentName}`,
    '',
    `- Format: **${analysis.format.toUpperCase()}**`,
    `- Print density: ${describeDensity(analysis.dpmm)}`,
    `- Labels in document: ${analysis.pages.length}`,
    `- Drawing operations: ${analysis.totalOps}`,
    `- Barcodes: ${analysis.totalBarcodes}`,
    `- Source size: ${analysis.sourceBytes} bytes`,
    `- Findings: ${counts.error} error(s), ${counts.warning} warning(s), ${counts.information} note(s)`,
    '',
  ];

  analysis.pages.forEach((page) => {
    lines.push(
      `## Label ${page.index + 1}`,
      '',
      `- Size: ${page.widthDots} x ${page.heightDots} dots (${page.widthInches}" x ${page.heightInches}")`,
      `- Content: ${opSummary(page)}`,
      `- Content bounds: ${page.contentExtent.width} x ${page.contentExtent.height} dots at (${page.contentExtent.x}, ${page.contentExtent.y})`,
      `- Estimated ink coverage: ${page.inkCoveragePercent}% (${coverageNote(page.inkCoveragePercent)})`,
      `- Fonts used: ${page.fonts.length > 0 ? page.fonts.map((f) => `\`${f}\``).join(', ') : '—'}`,
      '',
    );

    if (page.outOfBounds.length > 0) {
      lines.push(
        `> ${page.outOfBounds.length} field(s) fall outside the printable area.`,
        '',
      );
    }

    if (page.barcodes.length > 0) {
      lines.push('### Barcodes', '', '| Symbology | Data | Position | Status |', '|---|---|---|---|');
      for (const barcode of page.barcodes) {
        const status =
          barcode.issues.length === 0
            ? 'OK'
            : barcode.issues
                .map((issue) => `${issue.severity}: ${issue.message}`)
                .join('<br>');
        const data =
          barcode.data.length > 40
            ? `${barcode.data.slice(0, 40)}…`
            : barcode.data || '_(empty)_';
        lines.push(
          `| ${barcode.label} | \`${data.replace(/\|/g, '\\|')}\` | ${barcode.x}, ${barcode.y} | ${status} |`,
        );
      }
      lines.push('');
    }
  });

  if (diagnostics.length > 0) {
    lines.push('## Findings', '');
    const order: LabelDiagnostic['severity'][] = ['error', 'warning', 'information'];
    for (const severity of order) {
      const matching = diagnostics.filter((d) => d.severity === severity);
      if (matching.length === 0) {
        continue;
      }
      lines.push(`### ${severity[0].toUpperCase()}${severity.slice(1)}s`, '');
      for (const diagnostic of matching) {
        lines.push(
          `- ${diagnostic.message}${diagnostic.rule ? ` _(${diagnostic.rule})_` : ''}`,
        );
      }
      lines.push('');
    }
  } else {
    lines.push('## Findings', '', 'No problems found.', '');
  }

  if (analysis.warnings.length > 0) {
    lines.push('## Interpreter warnings', '');
    for (const warning of analysis.warnings) {
      lines.push(`- ${warning}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
