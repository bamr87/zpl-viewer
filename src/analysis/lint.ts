/**
 * Semantic lint rules that run on the shared IR, so they apply to every
 * printer language the extension understands.
 *
 * Syntax validation (`src/validation.ts`, `src/formats/epl/validation.ts`)
 * answers "will the printer parse this?"; these rules answer the more useful
 * question: "will the label that comes out actually scan and fit?"
 */

import { LabelDiagnostic } from '../core/diagnostics';
import { ParsedLabel } from '../core/pipeline';
import { findSymbology } from '../barcode/symbologies';
import { validateBarcodeData } from '../barcode/validate';
import { opExtent } from './metrics';

export interface LintOptions {
  /** Report barcode payload problems (default true). */
  barcodeData?: boolean;
  /** Report fields that leave the printable area (default true). */
  bounds?: boolean;
  /** Report scannability risks: thin modules, short bars, small quiet zones. */
  scannability?: boolean;
}

/**
 * Narrow-module widths below this many dots are widely reported as unreliable
 * on 203 dpi printers; the X-dimension is what most scanner failures come down
 * to.
 */
const MIN_MODULE_DOTS = 2;

/** ANSI/ISO guidance: a linear bar height of at least 15% of symbol length. */
const MIN_BAR_HEIGHT_RATIO = 0.15;

function span(
  source: { start: number; end: number } | undefined,
  fallbackLength: number,
): { start: number; end: number } {
  if (source) {
    return source;
  }
  return { start: 0, end: Math.min(1, fallbackLength) };
}

export function lintLabel(
  parsed: ParsedLabel,
  source: string,
  options: LintOptions = {},
): LabelDiagnostic[] {
  const checkBarcodeData = options.barcodeData ?? true;
  const checkBounds = options.bounds ?? true;
  const checkScannability = options.scannability ?? true;
  const diagnostics: LabelDiagnostic[] = [];

  if (parsed.pages.length === 0 && source.trim().length > 0) {
    diagnostics.push({
      start: 0,
      end: Math.min(1, source.length),
      message:
        parsed.format === 'zpl'
          ? 'No complete label found: a ZPL format runs from `^XA` to `^XZ`.'
          : 'No complete label found: an EPL format ends with `P`.',
      severity: 'warning',
      rule: 'label.no-pages',
    });
  }

  parsed.pages.forEach((page, pageIndex) => {
    const pageLabel = parsed.pages.length > 1 ? ` (label ${pageIndex + 1})` : '';
    for (const op of page.ops) {
      const extent = opExtent(op);
      const at = span(op.source, source.length);

      if (checkBounds) {
        const absX = page.homeX + extent.x;
        const absY = page.homeY + extent.y;
        if (absX < 0 || absY < 0) {
          diagnostics.push({
            start: at.start,
            end: at.end,
            message: `Field origin (${absX}, ${absY}) is off the label${pageLabel}; negative coordinates are clipped by the printer.`,
            severity: 'warning',
            rule: 'layout.negative-origin',
          });
        } else if (absX >= page.width || absY >= page.height) {
          diagnostics.push({
            start: at.start,
            end: at.end,
            message: `Field origin (${absX}, ${absY}) is outside the ${page.width}x${page.height} dot label${pageLabel}; nothing will print.`,
            severity: 'error',
            rule: 'layout.out-of-bounds',
          });
        } else if (
          absX + extent.width > page.width ||
          absY + extent.height > page.height
        ) {
          diagnostics.push({
            start: at.start,
            end: at.end,
            message: `Field extends to (${absX + extent.width}, ${absY + extent.height}), past the ${page.width}x${page.height} dot label${pageLabel}; it will be clipped.`,
            severity: 'warning',
            rule: 'layout.clipped',
          });
        }
      }

      if (op.type !== 'barcode') {
        if (op.type === 'text' && op.data.trim() === '') {
          diagnostics.push({
            start: at.start,
            end: at.end,
            message: 'Text field has no data.',
            severity: 'information',
            rule: 'text.empty',
          });
        }
        continue;
      }

      if (checkBarcodeData) {
        for (const issue of validateBarcodeData(op.symbology, op.data)) {
          diagnostics.push({
            start: at.start,
            end: at.end,
            message: issue.message,
            severity: issue.severity === 'info' ? 'information' : issue.severity,
            rule: `barcode.${issue.code}`,
          });
        }
      }

      if (!checkScannability) {
        continue;
      }
      const spec = findSymbology(op.symbology);
      if (spec?.kind === '2d') {
        if ((op.magnification ?? 4) < 2) {
          diagnostics.push({
            start: at.start,
            end: at.end,
            message: `${spec.label} magnification ${op.magnification ?? 4} produces single-dot modules; most imagers need at least 2.`,
            severity: 'warning',
            rule: 'barcode.module-width',
          });
        }
        continue;
      }
      if (op.moduleWidth < MIN_MODULE_DOTS) {
        diagnostics.push({
          start: at.start,
          end: at.end,
          message: `Narrow bar width of ${op.moduleWidth} dot(s) is below the ${MIN_MODULE_DOTS}-dot X-dimension most scanners need at ${parsed.dpmm} dpmm.`,
          severity: 'warning',
          rule: 'barcode.module-width',
        });
      }
      if (op.height > 0 && extent.width > 0) {
        const ratio = op.height / extent.width;
        if (ratio < MIN_BAR_HEIGHT_RATIO) {
          diagnostics.push({
            start: at.start,
            end: at.end,
            message: `Bar height ${op.height} dots is under 15% of the symbol width (~${extent.width} dots); scanners may fail to acquire it.`,
            severity: 'information',
            rule: 'barcode.bar-height',
          });
        }
      }
      const quietZone = 10 * Math.max(1, op.moduleWidth);
      if (page.homeX + op.x < quietZone) {
        diagnostics.push({
          start: at.start,
          end: at.end,
          message: `Barcode starts ${page.homeX + op.x} dots from the edge; leave a quiet zone of at least ${quietZone} dots (10x the narrow bar).`,
          severity: 'information',
          rule: 'barcode.quiet-zone',
        });
      }
    }
  });

  return diagnostics;
}
