/**
 * IR to ZPL II emitter.
 *
 * Turning the intermediate representation back into source is what makes
 * "create" and "convert" possible: an EPL document, a barcode built in the
 * studio, or a template assembled from a data row all become ordinary ZPL that
 * any Zebra printer accepts.
 */

import {
  BarcodeOp,
  BoxOp,
  CircleOp,
  DiagonalOp,
  EllipseOp,
  ImageOp,
  LabelPage,
  LineOp,
  Op,
  RenderResult,
  Rotation,
  TextOp,
} from '../renderer/ir';
import { findSymbology } from '../barcode/symbologies';
import { encodeAsciiHexGraphic } from '../renderer/graphics';
import { escapeZplData } from '../data/template';

export interface EmitResult {
  text: string;
  /** Anything that could not be represented exactly in the target language. */
  warnings: string[];
}

export interface EmitZplOptions {
  /** Emit `^PW` / `^LL` from the page size (default true). */
  includeSetup?: boolean;
  /** One command per line (default true). */
  multiline?: boolean;
}

function zplRotation(rotation: Rotation): string {
  return rotation;
}

function fieldData(data: string): { text: string; hex: boolean } {
  const { value, escaped } = escapeZplData(data);
  return { text: value, hex: escaped };
}

function emitText(op: TextOp): string {
  const { text, hex } = fieldData(op.data);
  const parts = [
    `^FO${op.x},${op.y}`,
    `^A0${zplRotation(op.rotation)},${Math.max(1, Math.round(op.fontHeight))},${Math.max(1, Math.round(op.fontWidth))}`,
  ];
  if (op.block) {
    parts.push(
      `^FB${op.block.width},${op.block.maxLines},${op.block.lineSpacing},${op.block.justification},${op.block.hangingIndent}`,
    );
  }
  if (op.reverse) {
    parts.push('^FR');
  }
  if (hex) {
    parts.push('^FH');
  }
  parts.push(`^FD${text}^FS`);
  return parts.join('');
}

function emitBox(op: BoxOp): string {
  return `^FO${op.x},${op.y}^GB${op.width},${op.height},${op.thickness},${op.color},${op.rounding}^FS`;
}

function emitLine(op: LineOp): string {
  const thickness = Math.max(1, op.thickness);
  const geometry =
    op.direction === 'horizontal'
      ? `${op.length},${thickness},${thickness}`
      : `${thickness},${op.length},${thickness}`;
  return `^FO${op.x},${op.y}^GB${geometry},${op.color}^FS`;
}

function emitDiagonal(op: DiagonalOp): string {
  return `^FO${op.x},${op.y}^GD${op.width},${op.height},${op.thickness},${op.color},${op.orientation}^FS`;
}

function emitCircle(op: CircleOp): string {
  return `^FO${op.x},${op.y}^GC${op.diameter},${op.thickness},${op.color}^FS`;
}

function emitEllipse(op: EllipseOp): string {
  return `^FO${op.x},${op.y}^GE${op.width},${op.height},${op.thickness},${op.color}^FS`;
}

function emitImage(op: ImageOp, warnings: string[]): string {
  const total = op.bitmap.length;
  const reverse = op.invert ?? op.reverse ? '^FR' : '';
  const field = `^GFA,${total},${total},${op.bytesPerRow},${encodeAsciiHexGraphic(op.bitmap, op.bytesPerRow)}`;

  const scaleX = Math.max(1, Math.round(op.scaleX ?? 1));
  const scaleY = Math.max(1, Math.round(op.scaleY ?? 1));
  if (scaleX === 1 && scaleY === 1) {
    return `^FO${op.x},${op.y}${reverse}${field}^FS`;
  }

  // A `^GF` carries no magnification of its own — only `^XG` does, and that
  // needs the graphic to already live in printer memory. Downloading it and
  // recalling it keeps the size exact and costs one extra command.
  warnings.push(
    `Magnified graphic emitted as ~DG + ^XG so the ${scaleX}x${scaleY} scale survives.`,
  );
  const name = (op.sourceName ?? `GFX${op.x}X${op.y}`).replace(/[^A-Z0-9]/gi, '').slice(0, 8) || 'GFX';
  const download = `~DGR:${name}.GRF,${total},${op.bytesPerRow},${encodeAsciiHexGraphic(op.bitmap, op.bytesPerRow)}`;
  return `${download}\n^FO${op.x},${op.y}${reverse}^XGR:${name}.GRF,${scaleX},${scaleY}^FS`;
}

/** Builds the ZPL barcode command for an op, without the field data. */
export function zplBarcodeCommand(op: BarcodeOp): string | undefined {
  const spec = findSymbology(op.symbology);
  if (!spec?.zplCommand) {
    return undefined;
  }
  const rotation = zplRotation(op.rotation);
  const hri = op.interpretation ? 'Y' : 'N';
  const above = op.interpretationAbove ? 'Y' : 'N';
  switch (spec.zplCommand) {
    case '^BQ':
      return `^BQ${rotation},2,${op.magnification ?? 5},${op.errorCorrection ?? 'Q'}`;
    case '^BX':
      return `^BX${rotation},${Math.max(1, op.moduleWidth)},200${op.columns ? `,,${op.columns}` : ''}`;
    case '^B7':
      return `^B7${rotation},${op.height},${op.errorCorrection ?? 5},${op.columns ?? ''},${op.rows ?? ''},N`;
    case '^BO':
      return `^BO${rotation},${op.magnification ?? 5},N,,,,N`;
    case '^BD':
      return '^BD';
    case '^B3':
    case '^B1':
    case '^BK':
    case '^BM':
    case '^BP':
      // These put the check-digit flag before the height.
      return `${spec.zplCommand}${rotation},N,${op.height},${hri},${above}`;
    default:
      return `${spec.zplCommand}${rotation},${op.height},${hri},${above},N`;
  }
}

function emitBarcode(op: BarcodeOp, warnings: string[]): string {
  const command = zplBarcodeCommand(op);
  if (!command) {
    warnings.push(
      `No ZPL command for symbology "${op.symbology}"; field was emitted as text.`,
    );
    const { text } = fieldData(op.data);
    return `^FO${op.x},${op.y}^FD${text}^FS`;
  }
  const { text, hex } = fieldData(op.data);
  const parts = [
    `^FO${op.x},${op.y}`,
    `^BY${Math.max(1, op.moduleWidth)},${op.ratio.toFixed(1)},${op.height}`,
    command,
  ];
  if (hex) {
    parts.push('^FH');
  }
  parts.push(`^FD${text}^FS`);
  return parts.join('');
}

function emitOp(op: Op, warnings: string[]): string {
  switch (op.type) {
    case 'text':
      return emitText(op);
    case 'box':
      return emitBox(op);
    case 'line':
      return emitLine(op);
    case 'diagonal':
      return emitDiagonal(op);
    case 'circle':
      return emitCircle(op);
    case 'ellipse':
      return emitEllipse(op);
    case 'barcode':
      return emitBarcode(op, warnings);
    case 'image':
      return emitImage(op, warnings);
    default:
      return '';
  }
}

export function emitZplPage(
  page: LabelPage,
  options: EmitZplOptions = {},
  warnings: string[] = [],
): string {
  const includeSetup = options.includeSetup ?? true;
  const multiline = options.multiline ?? true;
  const lines: string[] = ['^XA'];
  if (includeSetup) {
    lines.push(`^PW${page.width}`, `^LL${page.height}`);
  }
  if (page.homeX !== 0 || page.homeY !== 0) {
    lines.push(`^LH${page.homeX},${page.homeY}`);
  }
  for (const op of page.ops) {
    const emitted = emitOp(op, warnings);
    if (emitted) {
      lines.push(emitted);
    }
  }
  lines.push('^XZ');
  return multiline ? lines.join('\n') : lines.join('');
}

export function emitZpl(
  result: RenderResult,
  options: EmitZplOptions = {},
): EmitResult {
  const warnings: string[] = [];
  const pages = result.pages.map((page) => emitZplPage(page, options, warnings));
  return { text: pages.join('\n') + '\n', warnings };
}
