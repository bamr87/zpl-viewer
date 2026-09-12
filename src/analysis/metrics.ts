/**
 * Label analysis: geometry, inventory and estimated ink coverage.
 *
 * Everything here is computed from the shared IR, so it works the same for a
 * ZPL document, an EPL document, or a label that was merged from data.
 */

import { Op, LabelPage } from '../renderer/ir';
import { ParsedLabel } from '../core/pipeline';
import { dotsToInches } from '../core/units';
import { findSymbology } from '../barcode/symbologies';
import { BarcodeIssue, validateBarcodeData } from '../barcode/validate';

export interface OpExtent {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Conservative bounding box for an op, in dots.
 *
 * Text and barcode widths are estimates: the printer's glyph metrics and the
 * encoder's module count are not known until the label is rasterized, so these
 * use the standard cell widths and symbology module counts. Good enough to
 * catch a field that runs off the edge of the stock, which is the point.
 */
export function opExtent(op: Op): OpExtent {
  switch (op.type) {
    case 'text': {
      const lines = op.block ? Math.max(1, op.block.maxLines) : 1;
      const width = op.block
        ? op.block.width
        : Math.round(op.data.length * op.fontWidth * 0.8);
      return {
        x: op.x,
        y: op.y,
        width,
        height: op.fontHeight * lines,
      };
    }
    case 'box':
      return { x: op.x, y: op.y, width: op.width, height: op.height };
    case 'line':
      return op.direction === 'horizontal'
        ? { x: op.x, y: op.y, width: op.length, height: op.thickness }
        : { x: op.x, y: op.y, width: op.thickness, height: op.length };
    case 'diagonal':
    case 'ellipse':
      return { x: op.x, y: op.y, width: op.width, height: op.height };
    case 'circle':
      return { x: op.x, y: op.y, width: op.diameter, height: op.diameter };
    case 'image':
      // ^XG magnification scales a recalled graphic, so the printed extent is
      // not the stored bitmap's size.
      return {
        x: op.x,
        y: op.y,
        width: op.width * Math.max(1, op.scaleX ?? 1),
        height: op.height * Math.max(1, op.scaleY ?? 1),
      };
    case 'barcode': {
      const spec = findSymbology(op.symbology);
      if (spec?.kind === '2d') {
        const modules = Math.ceil(Math.sqrt(Math.max(1, op.data.length) * 8)) + 8;
        const size = modules * Math.max(1, op.magnification ?? 4);
        return { x: op.x, y: op.y, width: size, height: size };
      }
      // Linear symbologies encode roughly 11 modules per character plus
      // start/stop patterns.
      const modules = op.data.length * 11 + 35;
      return {
        x: op.x,
        y: op.y,
        width: modules * Math.max(1, op.moduleWidth),
        height: op.height + (op.interpretation ? 20 : 0),
      };
    }
    default:
      return { x: 0, y: 0, width: 0, height: 0 };
  }
}

/** UTF-8 byte count, computed without Node's Buffer so the webview can use it. */
export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

function countSetBits(bitmap: Uint8Array): number {
  let bits = 0;
  for (const byte of bitmap) {
    let value = byte;
    while (value) {
      bits += value & 1;
      value >>= 1;
    }
  }
  return bits;
}

/** Estimated number of dots this op burns, used for the coverage figure. */
export function estimateInkArea(op: Op): number {
  const extent = opExtent(op);
  switch (op.type) {
    case 'text':
      // Roughly a third of a glyph cell is ink for typical sans-serif text.
      return Math.round(extent.width * extent.height * 0.33);
    case 'box':
      return Math.round(
        2 * op.thickness * (op.width + op.height) - 4 * op.thickness * op.thickness,
      );
    case 'line':
      return op.color === 'W' ? 0 : Math.round(extent.width * extent.height);
    case 'diagonal':
      return Math.round(
        Math.hypot(op.width, op.height) * Math.max(1, op.thickness),
      );
    case 'circle':
      return Math.round(Math.PI * op.diameter * Math.max(1, op.thickness));
    case 'ellipse':
      return Math.round(
        Math.PI * ((op.width + op.height) / 2) * Math.max(1, op.thickness),
      );
    case 'barcode':
      // Bars and spaces are close to an even split.
      return Math.round(extent.width * extent.height * 0.5);
    case 'image':
      return (
        countSetBits(op.bitmap) *
        Math.max(1, op.scaleX ?? 1) *
        Math.max(1, op.scaleY ?? 1)
      );
    default:
      return 0;
  }
}

export interface BarcodeInventoryEntry {
  symbology: string;
  label: string;
  data: string;
  issues: BarcodeIssue[];
  x: number;
  y: number;
  source?: { start: number; end: number };
}

export interface PageMetrics {
  index: number;
  widthDots: number;
  heightDots: number;
  widthInches: number;
  heightInches: number;
  opCount: number;
  opCounts: Record<string, number>;
  fonts: string[];
  barcodes: BarcodeInventoryEntry[];
  /** Ops whose bounding box leaves the printable area. */
  outOfBounds: { op: Op; extent: OpExtent }[];
  /** Estimated percentage of the label covered in ink. */
  inkCoveragePercent: number;
  /** Bounding box of everything drawn on the page. */
  contentExtent: OpExtent;
}

export interface LabelAnalysis {
  format: string;
  dpmm: number;
  pages: PageMetrics[];
  totalOps: number;
  totalBarcodes: number;
  barcodeIssueCount: number;
  warnings: string[];
  /** Bytes the document occupies on the wire. */
  sourceBytes: number;
}

function analyzePage(page: LabelPage, index: number, dpmm: number): PageMetrics {
  const opCounts: Record<string, number> = {};
  const fonts = new Set<string>();
  const barcodes: BarcodeInventoryEntry[] = [];
  const outOfBounds: { op: Op; extent: OpExtent }[] = [];
  let ink = 0;
  let minX = Number.MAX_SAFE_INTEGER;
  let minY = Number.MAX_SAFE_INTEGER;
  let maxX = 0;
  let maxY = 0;

  for (const op of page.ops) {
    opCounts[op.type] = (opCounts[op.type] ?? 0) + 1;
    const extent = opExtent(op);
    ink += estimateInkArea(op);

    const absX = page.homeX + extent.x;
    const absY = page.homeY + extent.y;
    minX = Math.min(minX, absX);
    minY = Math.min(minY, absY);
    maxX = Math.max(maxX, absX + extent.width);
    maxY = Math.max(maxY, absY + extent.height);

    if (
      absX < 0 ||
      absY < 0 ||
      absX + extent.width > page.width ||
      absY + extent.height > page.height
    ) {
      outOfBounds.push({ op, extent: { ...extent, x: absX, y: absY } });
    }

    if (op.type === 'text') {
      fonts.add(op.font);
    }
    if (op.type === 'barcode') {
      const spec = findSymbology(op.symbology);
      barcodes.push({
        symbology: op.symbology,
        label: spec?.label ?? op.symbology,
        data: op.data,
        issues: validateBarcodeData(op.symbology, op.data),
        x: op.x,
        y: op.y,
        source: op.source,
      });
    }
  }

  const area = Math.max(1, page.width * page.height);
  return {
    index,
    widthDots: page.width,
    heightDots: page.height,
    widthInches: Number(dotsToInches(page.width, dpmm).toFixed(2)),
    heightInches: Number(dotsToInches(page.height, dpmm).toFixed(2)),
    opCount: page.ops.length,
    opCounts,
    fonts: [...fonts],
    barcodes,
    outOfBounds,
    inkCoveragePercent: Number(((ink / area) * 100).toFixed(1)),
    contentExtent:
      page.ops.length === 0
        ? { x: 0, y: 0, width: 0, height: 0 }
        : { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
  };
}

export function analyzeLabel(
  parsed: ParsedLabel,
  source: string,
): LabelAnalysis {
  const pages = parsed.pages.map((page, index) =>
    analyzePage(page, index, parsed.dpmm),
  );
  const totalBarcodes = pages.reduce((sum, page) => sum + page.barcodes.length, 0);
  const barcodeIssueCount = pages.reduce(
    (sum, page) =>
      sum +
      page.barcodes.reduce((inner, entry) => inner + entry.issues.length, 0),
    0,
  );
  return {
    format: parsed.format,
    dpmm: parsed.dpmm,
    pages,
    totalOps: pages.reduce((sum, page) => sum + page.opCount, 0),
    totalBarcodes,
    barcodeIssueCount,
    warnings: parsed.warnings,
    sourceBytes: utf8ByteLength(source),
  };
}
