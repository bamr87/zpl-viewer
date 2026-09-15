/**
 * IR to EPL2 emitter. The inverse of `formats/epl/parser.ts`, and the second
 * half of format conversion.
 *
 * EPL2 has a smaller primitive set than ZPL — no circles, ellipses or
 * diagonals, and a fixed ladder of bitmap fonts — so the emitter reports every
 * approximation it makes instead of silently dropping geometry.
 */

import {
  BarcodeOp,
  BoxOp,
  ImageOp,
  LabelPage,
  LineOp,
  Op,
  RenderResult,
  Rotation,
  TextOp,
} from '../renderer/ir';
import { findSymbology } from '../barcode/symbologies';
import { escapeEplData } from '../data/template';
import { EmitResult } from './zpl';

export interface EmitEplOptions {
  /** Emit `N`, `q`, `Q` and the trailing `P1` (default true). */
  includeSetup?: boolean;
  /** Dots per millimetre of the target printer, for font scaling. */
  dpmm?: number;
}

/** Font cell sizes (width x height in dots) for EPL fonts 1-5 at 203 dpi. */
const FONT_CELLS: { id: string; width: number; height: number }[] = [
  { id: '1', width: 8, height: 12 },
  { id: '2', width: 10, height: 16 },
  { id: '3', width: 12, height: 20 },
  { id: '4', width: 14, height: 24 },
  { id: '5', width: 32, height: 48 },
];

function eplRotation(rotation: Rotation): number {
  switch (rotation) {
    case 'R':
      return 1;
    case 'I':
      return 2;
    case 'B':
      return 3;
    default:
      return 0;
  }
}

/**
 * Picks the EPL font and multipliers that land closest to a requested glyph
 * size. EPL only has five bitmap cells scaled by integer multipliers, so exact
 * matches are the exception.
 */
export function chooseEplFont(
  heightDots: number,
  widthDots: number,
  dpmm = 8,
): { font: string; hMult: number; vMult: number; exact: boolean } {
  const scale = dpmm / 8;
  let best = { font: '3', hMult: 1, vMult: 1, error: Number.MAX_VALUE, exact: false };
  for (const cell of FONT_CELLS) {
    const cellHeight = cell.height * scale;
    const cellWidth = cell.width * scale;
    for (let vMult = 1; vMult <= 9; vMult += 1) {
      const heightError = Math.abs(cellHeight * vMult - heightDots);
      for (let hMult = 1; hMult <= 8; hMult += 1) {
        const widthError = Math.abs(cellWidth * hMult - widthDots);
        const error = heightError * 2 + widthError;
        if (error < best.error) {
          best = {
            font: cell.id,
            hMult,
            vMult,
            error,
            exact: heightError === 0 && widthError === 0,
          };
        }
      }
    }
  }
  return { font: best.font, hMult: best.hMult, vMult: best.vMult, exact: best.exact };
}

function emitText(op: TextOp, dpmm: number, warnings: string[]): string {
  const { font, hMult, vMult, exact } = chooseEplFont(
    op.fontHeight,
    op.fontWidth,
    dpmm,
  );
  if (!exact) {
    warnings.push(
      `Text "${op.data.slice(0, 24)}" resized to EPL font ${font} x${hMult},${vMult} (EPL has fixed bitmap fonts).`,
    );
  }
  if (op.block) {
    warnings.push(
      'EPL has no text-block command; the field was emitted as a single line.',
    );
  }
  return `A${op.x},${op.y},${eplRotation(op.rotation)},${font},${hMult},${vMult},${op.reverse ? 'R' : 'N'},"${escapeEplData(op.data)}"`;
}

function emitBox(op: BoxOp): string {
  return `X${op.x},${op.y},${op.thickness},${op.x + op.width},${op.y + op.height}`;
}

function emitLine(op: LineOp): string {
  const command = op.color === 'W' ? 'LE' : 'LO';
  return op.direction === 'horizontal'
    ? `${command}${op.x},${op.y},${op.length},${Math.max(1, op.thickness)}`
    : `${command}${op.x},${op.y},${Math.max(1, op.thickness)},${op.length}`;
}

function emitBarcode(op: BarcodeOp, warnings: string[]): string | undefined {
  const spec = findSymbology(op.symbology);
  if (!spec) {
    warnings.push(`Unknown symbology "${op.symbology}"; barcode was dropped.`);
    return undefined;
  }
  const rotation = eplRotation(op.rotation);
  if (spec.kind === '2d') {
    if (!spec.epl2dCode) {
      warnings.push(
        `EPL2 cannot print ${spec.label}; the field was dropped from the converted label.`,
      );
      return undefined;
    }
    const options = [`s${Math.max(1, op.magnification ?? 4)}`];
    if (spec.id === 'qrcode') {
      options.unshift('m2');
      if (op.errorCorrection) {
        options.push(`e${op.errorCorrection.toUpperCase()}`);
      }
    }
    return `b${op.x},${op.y},${spec.epl2dCode},${options.join(',')},"${escapeEplData(op.data)}"`;
  }
  if (!spec.eplCode) {
    warnings.push(
      `EPL2 has no selector for ${spec.label}; the field was dropped from the converted label.`,
    );
    return undefined;
  }
  const narrow = Math.max(1, op.moduleWidth);
  const wide = Math.max(narrow + 1, Math.round(narrow * (op.ratio || 3)));
  return `B${op.x},${op.y},${rotation},${spec.eplCode},${narrow},${wide},${Math.max(1, op.height)},${op.interpretation ? 'B' : 'N'},"${escapeEplData(op.data)}"`;
}

function emitImage(op: ImageOp, warnings: string[]): string {
  warnings.push(
    'Graphic field converted to `GW`; the binary payload must reach the printer verbatim.',
  );

  // EPL's GW has no magnification parameter, so a magnified graphic has to be
  // expanded into real dots before it is written.
  const scaleX = Math.max(1, Math.round(op.scaleX ?? 1));
  const scaleY = Math.max(1, Math.round(op.scaleY ?? 1));
  const scaled = scaleX === 1 && scaleY === 1 ? op : scaleBitmap(op, scaleX, scaleY);
  if (scaled !== op) {
    warnings.push(
      `Magnified graphic expanded to ${scaled.width}x${scaled.height} dots; EPL2 GW cannot scale.`,
    );
  }

  let raw = '';
  for (const byte of scaled.bitmap) {
    // GW burns a dot for a 0 bit, the inverse of the IR's convention.
    raw += String.fromCharCode(~byte & 0xff);
  }
  return `GW${op.x},${op.y},${scaled.bytesPerRow},${scaled.height},${raw}`;
}

/** Nearest-neighbour expansion of a 1-bit bitmap by whole-dot factors. */
function scaleBitmap(
  op: ImageOp,
  scaleX: number,
  scaleY: number,
): { bitmap: Uint8Array; bytesPerRow: number; width: number; height: number } {
  const width = op.width * scaleX;
  const height = op.height * scaleY;
  const bytesPerRow = Math.ceil(width / 8);
  const bitmap = new Uint8Array(bytesPerRow * height);

  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.floor(y / scaleY);
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.floor(x / scaleX);
      const byte = op.bitmap[sourceY * op.bytesPerRow + (sourceX >> 3)] ?? 0;
      if ((byte >> (7 - (sourceX & 7))) & 1) {
        bitmap[y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
  }
  return { bitmap, bytesPerRow, width, height };
}

function emitOp(op: Op, dpmm: number, warnings: string[]): string | undefined {
  switch (op.type) {
    case 'text':
      return emitText(op, dpmm, warnings);
    case 'box':
      return emitBox(op);
    case 'line':
      return emitLine(op);
    case 'barcode':
      return emitBarcode(op, warnings);
    case 'image':
      return emitImage(op, warnings);
    case 'circle':
      warnings.push('EPL2 has no circle command; the shape was dropped.');
      return undefined;
    case 'ellipse':
      warnings.push('EPL2 has no ellipse command; the shape was dropped.');
      return undefined;
    case 'diagonal':
      warnings.push('EPL2 has no diagonal-line command; the shape was dropped.');
      return undefined;
    default:
      return undefined;
  }
}

export function emitEplPage(
  page: LabelPage,
  options: EmitEplOptions = {},
  warnings: string[] = [],
): string {
  const includeSetup = options.includeSetup ?? true;
  const dpmm = options.dpmm ?? 8;
  const lines: string[] = [];
  if (includeSetup) {
    lines.push('N', `q${page.width}`, `Q${page.height},24`);
  }
  if (page.homeX !== 0 || page.homeY !== 0) {
    lines.push(`R${page.homeX},${page.homeY}`);
  }
  for (const op of page.ops) {
    const emitted = emitOp(op, dpmm, warnings);
    if (emitted) {
      lines.push(emitted);
    }
  }
  if (includeSetup) {
    lines.push('P1');
  }
  return lines.join('\n');
}

export function emitEpl(
  result: RenderResult,
  options: EmitEplOptions = {},
): EmitResult {
  const warnings: string[] = [];
  const dpmm = options.dpmm ?? result.dpmm;
  const pages = result.pages.map((page) =>
    emitEplPage(page, { ...options, dpmm }, warnings),
  );
  return { text: pages.join('\n') + '\n', warnings };
}
