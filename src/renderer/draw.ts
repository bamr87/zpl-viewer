/**
 * Draws an IR label page onto a Canvas 2D context. This module is isomorphic:
 * it does not touch the DOM or Node APIs and can run in either the webview or
 * a headless or recording canvas.
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
  Rotation,
  TextOp,
} from './ir';
import { glyphXScale } from './text';

/** Minimal bwip-js toCanvas-ish contract used by the renderer. */
export interface BarcodeRenderer {
  render(op: BarcodeOp): HTMLCanvasElement | OffscreenCanvas;
}

export interface DrawOptions {
  /** Display scale factor (1 = 1 dot per canvas pixel). */
  scale?: number;
  /** Background color (defaults to white). */
  background?: string;
  /** Optional font family for text ops. */
  fontFamily?: string;
}

export function drawPage(
  ctx: CanvasRenderingContext2D,
  page: LabelPage,
  barcodes: BarcodeRenderer,
  options: DrawOptions = {},
): void {
  const scale = options.scale ?? 1;
  const fontFamily = options.fontFamily ?? 'Helvetica, Arial, sans-serif';

  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, 0, 0);

  ctx.fillStyle = options.background ?? '#ffffff';
  ctx.fillRect(0, 0, page.width, page.height);

  for (const op of page.ops) {
    ctx.save();
    // Apply label home offset.
    ctx.translate(page.homeX + op.x, page.homeY + op.y);
    applyRotation(ctx, op.rotation);

    switch (op.type) {
      case 'text':
        drawText(ctx, op, fontFamily);
        break;
      case 'box':
        drawBox(ctx, op);
        break;
      case 'line':
        drawLine(ctx, op);
        break;
      case 'diagonal':
        drawDiagonal(ctx, op);
        break;
      case 'circle':
        drawCircle(ctx, op);
        break;
      case 'ellipse':
        drawEllipse(ctx, op);
        break;
      case 'barcode':
        drawBarcode(ctx, op, barcodes);
        break;
      case 'image':
        drawImage(ctx, op);
        break;
      default:
        break;
    }

    ctx.restore();
  }

  ctx.restore();
}

function applyRotation(
  ctx: CanvasRenderingContext2D,
  rotation: Rotation,
): void {
  switch (rotation) {
    case 'R':
      ctx.rotate(Math.PI / 2);
      break;
    case 'I':
      ctx.rotate(Math.PI);
      break;
    case 'B':
      ctx.rotate((3 * Math.PI) / 2);
      break;
    default:
      break;
  }
}

function drawText(
  ctx: CanvasRenderingContext2D,
  op: TextOp,
  fontFamily: string,
): void {
  const height = Math.max(6, op.fontHeight);
  ctx.font = `${height}px ${fontFamily}`;
  ctx.textBaseline = 'top';

  // ZPL width != CSS font width; `glyphXScale` bridges the two, and is shared
  // with the SVG exporter so every output agrees on how wide text is.
  const xScale = glyphXScale(op);

  ctx.save();
  ctx.scale(xScale, 1);
  if (op.reverse) {
    // Simulate reverse print by filling background black behind text.
    const metrics = ctx.measureText(op.data);
    const bgX = 0;
    const bgY = 0;
    const bgW = metrics.width;
    const bgH = height;
    ctx.fillStyle = '#000';
    ctx.fillRect(bgX, bgY, bgW, bgH);
    ctx.fillStyle = '#fff';
  } else {
    ctx.fillStyle = '#000';
  }

  if (op.block) {
    drawTextBlock(ctx, op, xScale, height);
  } else {
    ctx.fillText(op.data, 0, 0);
  }
  ctx.restore();
}

function drawTextBlock(
  ctx: CanvasRenderingContext2D,
  op: TextOp,
  xScale: number,
  lineHeight: number,
): void {
  if (!op.block) {
    return;
  }
  const maxWidth = op.block.width / xScale;
  const words = op.data.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const tentative = line ? line + ' ' + word : word;
    if (ctx.measureText(tentative).width > maxWidth && line) {
      lines.push(line);
      line = word;
      if (lines.length >= op.block.maxLines) {
        break;
      }
    } else {
      line = tentative;
    }
  }
  if (line && lines.length < op.block.maxLines) {
    lines.push(line);
  }

  const gap = lineHeight + op.block.lineSpacing;
  lines.forEach((l, i) => {
    const metrics = ctx.measureText(l);
    let x = 0;
    switch (op.block!.justification) {
      case 'C':
        x = (maxWidth - metrics.width) / 2;
        break;
      case 'R':
        x = maxWidth - metrics.width;
        break;
      default:
        x = i > 0 ? op.block!.hangingIndent / xScale : 0;
        break;
    }
    ctx.fillText(l, x, i * gap);
  });
}

function drawBox(ctx: CanvasRenderingContext2D, op: BoxOp): void {
  ctx.strokeStyle = op.color === 'W' ? '#ffffff' : '#000000';
  ctx.lineWidth = op.thickness;
  // ZPL ^GB draws the border outside the nominal rectangle, so inset by
  // thickness/2 to keep visual parity.
  const inset = op.thickness / 2;
  if (op.rounding > 0 && typeof (ctx as { roundRect?: unknown }).roundRect === 'function') {
    const r = Math.min(
      (Math.min(op.width, op.height) / 2) * (op.rounding / 8),
      Math.min(op.width, op.height) / 2,
    );
    ctx.beginPath();
    (ctx as CanvasRenderingContext2D & {
      roundRect(x: number, y: number, w: number, h: number, radii: number): void;
    }).roundRect(
      inset,
      inset,
      op.width - op.thickness,
      op.height - op.thickness,
      r,
    );
    ctx.stroke();
  } else {
    ctx.strokeRect(
      inset,
      inset,
      op.width - op.thickness,
      op.height - op.thickness,
    );
  }
}

function drawLine(ctx: CanvasRenderingContext2D, op: LineOp): void {
  ctx.fillStyle = op.color === 'W' ? '#ffffff' : '#000000';
  if (op.direction === 'horizontal') {
    ctx.fillRect(0, 0, op.length, op.thickness);
  } else {
    ctx.fillRect(0, 0, op.thickness, op.length);
  }
}

function drawDiagonal(
  ctx: CanvasRenderingContext2D,
  op: DiagonalOp,
): void {
  ctx.strokeStyle = op.color === 'W' ? '#ffffff' : '#000000';
  ctx.lineWidth = op.thickness;
  ctx.beginPath();
  if (op.orientation === 'L') {
    ctx.moveTo(op.width, 0);
    ctx.lineTo(0, op.height);
  } else {
    ctx.moveTo(0, 0);
    ctx.lineTo(op.width, op.height);
  }
  ctx.stroke();
}

function drawCircle(ctx: CanvasRenderingContext2D, op: CircleOp): void {
  ctx.strokeStyle = op.color === 'W' ? '#ffffff' : '#000000';
  ctx.lineWidth = op.thickness;
  const r = op.diameter / 2;
  ctx.beginPath();
  ctx.arc(r, r, r - op.thickness / 2, 0, Math.PI * 2);
  ctx.stroke();
}

function drawEllipse(ctx: CanvasRenderingContext2D, op: EllipseOp): void {
  ctx.strokeStyle = op.color === 'W' ? '#ffffff' : '#000000';
  ctx.lineWidth = op.thickness;
  ctx.beginPath();
  ctx.ellipse(
    op.width / 2,
    op.height / 2,
    op.width / 2 - op.thickness / 2,
    op.height / 2 - op.thickness / 2,
    0,
    0,
    Math.PI * 2,
  );
  ctx.stroke();
}

function drawBarcode(
  ctx: CanvasRenderingContext2D,
  op: BarcodeOp,
  barcodes: BarcodeRenderer,
): void {
  try {
    const canvas = barcodes.render(op);
    ctx.drawImage(canvas as CanvasImageSource, 0, 0);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.fillStyle = '#cc0000';
    ctx.font = '12px monospace';
    ctx.fillText(`barcode error: ${message}`, 0, 0);
  }
}

/**
 * Paints a 1-bit-per-pixel bitmap as runs of filled rectangles.
 *
 * The obvious implementation — build an ImageData and `putImageData` — cannot
 * be used here: `putImageData` writes device pixels and ignores the current
 * transform, so a graphic would land at the canvas origin with the label's home
 * offset, field rotation and preview zoom all thrown away. Filling one rect per
 * horizontal run of set pixels goes through the transform like every other op,
 * and on the sparse artwork labels actually carry it is a handful of rects per
 * row rather than one per dot.
 */
function drawImage(ctx: CanvasRenderingContext2D, op: ImageOp): void {
  const scaleX = op.scaleX && op.scaleX > 0 ? op.scaleX : 1;
  const scaleY = op.scaleY && op.scaleY > 0 ? op.scaleY : 1;
  const inverted = op.invert ?? op.reverse;

  if (inverted) {
    // Reverse print: the graphic's bounding box goes black and set bits punch
    // back out to white.
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, op.width * scaleX, op.height * scaleY);
  }
  ctx.fillStyle = inverted ? '#ffffff' : '#000000';

  for (let row = 0; row < op.height; row += 1) {
    const rowStart = row * op.bytesPerRow;
    let runStart = -1;
    for (let col = 0; col <= op.width; col += 1) {
      let on = false;
      if (col < op.width) {
        const byte = op.bitmap[rowStart + (col >> 3)] ?? 0;
        on = ((byte >> (7 - (col & 7))) & 1) === 1;
      }
      if (on && runStart < 0) {
        runStart = col;
      } else if (!on && runStart >= 0) {
        ctx.fillRect(
          runStart * scaleX,
          row * scaleY,
          (col - runStart) * scaleX,
          scaleY,
        );
        runStart = -1;
      }
    }
  }
}

export function totalPages(pages: LabelPage[]): number {
  return pages.length;
}

export function opsCount(pages: LabelPage[]): number {
  let total = 0;
  for (const p of pages) {
    total += p.ops.length;
  }
  return total;
}

export type { Op };
