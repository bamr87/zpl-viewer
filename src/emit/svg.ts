/**
 * Renders an IR label page to SVG.
 *
 * This is the third renderer beside the canvas preview and the PDF export, and
 * it earns its place twice over. It is *vector*: a label exported as SVG can be
 * placed in artwork, printed at any size and diffed as text, where a PNG can
 * only be looked at. And it needs no canvas at all, so export runs in the
 * extension host — no preview panel has to be open, and nothing has to be
 * rasterized — which is what makes SVG the one export that works headlessly.
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
} from '../renderer/ir';
import { NATURAL_GLYPH_ASPECT, glyphXScale } from '../renderer/text';

/** Produces the `<svg>` markup for a barcode op, sized in dots. */
export interface BarcodeSvgRenderer {
  render(op: BarcodeOp): string;
}

export interface SvgOptions {
  /** Dots per millimetre, written into the document as physical size. */
  dpmm?: number;
  background?: string;
  fontFamily?: string;
  barcodes?: BarcodeSvgRenderer;
  /** Adds a `<title>`, useful when the file is opened on its own. */
  title?: string;
}

const BLACK = '#000000';
const WHITE = '#ffffff';

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Rounds to a tenth of a dot: enough precision, far smaller files. */
function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function rotationDegrees(rotation: Rotation): number {
  switch (rotation) {
    case 'R':
      return 90;
    case 'I':
      return 180;
    case 'B':
      return 270;
    default:
      return 0;
  }
}

function openGroup(op: Op, homeX: number, homeY: number): string {
  const x = round(homeX + op.x);
  const y = round(homeY + op.y);
  const degrees = rotationDegrees(op.rotation);
  const transform =
    degrees === 0 ? `translate(${x} ${y})` : `translate(${x} ${y}) rotate(${degrees})`;
  return `<g transform="${transform}">`;
}

function color(value: 'B' | 'W'): string {
  return value === 'W' ? WHITE : BLACK;
}

function boxSvg(op: BoxOp): string {
  const inset = op.thickness / 2;
  const radius =
    op.rounding > 0
      ? Math.min(
          (Math.min(op.width, op.height) / 2) * (op.rounding / 8),
          Math.min(op.width, op.height) / 2,
        )
      : 0;
  const rx = radius > 0 ? ` rx="${round(radius)}"` : '';
  return (
    `<rect x="${round(inset)}" y="${round(inset)}" ` +
    `width="${round(op.width - op.thickness)}" height="${round(op.height - op.thickness)}"${rx} ` +
    `fill="none" stroke="${color(op.color)}" stroke-width="${round(op.thickness)}"/>`
  );
}

function lineSvg(op: LineOp): string {
  const width = op.direction === 'horizontal' ? op.length : op.thickness;
  const height = op.direction === 'horizontal' ? op.thickness : op.length;
  return `<rect x="0" y="0" width="${round(width)}" height="${round(height)}" fill="${color(op.color)}"/>`;
}

function diagonalSvg(op: DiagonalOp): string {
  const [x1, y1, x2, y2] =
    op.orientation === 'L' ? [op.width, 0, 0, op.height] : [0, 0, op.width, op.height];
  return (
    `<line x1="${round(x1)}" y1="${round(y1)}" x2="${round(x2)}" y2="${round(y2)}" ` +
    `stroke="${color(op.color)}" stroke-width="${round(op.thickness)}"/>`
  );
}

function circleSvg(op: CircleOp): string {
  const r = op.diameter / 2;
  return (
    `<circle cx="${round(r)}" cy="${round(r)}" r="${round(Math.max(0, r - op.thickness / 2))}" ` +
    `fill="none" stroke="${color(op.color)}" stroke-width="${round(op.thickness)}"/>`
  );
}

function ellipseSvg(op: EllipseOp): string {
  return (
    `<ellipse cx="${round(op.width / 2)}" cy="${round(op.height / 2)}" ` +
    `rx="${round(Math.max(0, op.width / 2 - op.thickness / 2))}" ` +
    `ry="${round(Math.max(0, op.height / 2 - op.thickness / 2))}" ` +
    `fill="none" stroke="${color(op.color)}" stroke-width="${round(op.thickness)}"/>`
  );
}

function textSvg(op: TextOp, fontFamily: string): string {
  const height = Math.max(6, op.fontHeight);
  // The same correction the canvas renderer applies, from the same helper.
  const xScale = glyphXScale(op);
  const scale = Math.abs(xScale - 1) < 0.01 ? '' : ` transform="scale(${round(xScale)} 1)"`;

  const lines = op.block ? wrapBlockText(op, xScale) : [op.data];
  const lineHeight = height + (op.block?.lineSpacing ?? 0);
  const blockWidth = op.block ? op.block.width / xScale : 0;

  const spans = lines
    .map((line, index) => {
      let anchor = 'start';
      let x = 0;
      if (op.block?.justification === 'C') {
        anchor = 'middle';
        x = blockWidth / 2;
      } else if (op.block?.justification === 'R') {
        anchor = 'end';
        x = blockWidth;
      } else if (op.block && index > 0) {
        x = op.block.hangingIndent / xScale;
      }
      return (
        `<text x="${round(x)}" y="${round(index * lineHeight)}" ` +
        `font-family="${escapeXml(fontFamily)}" font-size="${round(height)}" ` +
        `text-anchor="${anchor}" dominant-baseline="text-before-edge" ` +
        `fill="${op.reverse ? WHITE : BLACK}">${escapeXml(line)}</text>`
      );
    })
    .join('');

  if (!op.reverse) {
    return `<g${scale}>${spans}</g>`;
  }
  // Reverse print: lay a black field behind the glyphs. Width is estimated from
  // the glyph cell, the same approximation the canvas renderer makes.
  const longest = lines.reduce((max, line) => Math.max(max, line.length), 0);
  const backdropWidth = blockWidth > 0 ? blockWidth : longest * height * NATURAL_GLYPH_ASPECT;
  return (
    `<g${scale}><rect x="0" y="0" width="${round(backdropWidth)}" ` +
    `height="${round(lines.length * lineHeight)}" fill="${BLACK}"/>${spans}</g>`
  );
}

/**
 * Greedy word wrap for `^FB` blocks. Width is estimated from the glyph cell
 * rather than measured — there is no text metric engine here — so a block may
 * break one word differently from the canvas preview.
 */
function wrapBlockText(op: TextOp, xScale: number): string[] {
  if (!op.block) {
    return [op.data];
  }
  const maxWidth = op.block.width / xScale;
  const charWidth = Math.max(1, Math.max(6, op.fontHeight) * NATURAL_GLYPH_ASPECT);
  const maxChars = Math.max(1, Math.floor(maxWidth / charWidth));
  const words = op.data.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const tentative = line ? `${line} ${word}` : word;
    if (tentative.length > maxChars && line) {
      lines.push(line);
      line = word;
      if (lines.length >= op.block.maxLines) {
        return lines;
      }
    } else {
      line = tentative;
    }
  }
  if (line && lines.length < op.block.maxLines) {
    lines.push(line);
  }
  return lines;
}

/**
 * Emits a bitmap as one `<rect>` per horizontal run of dots. Runs keep the file
 * to a size a browser will open, and keep it a vector: no embedded raster, so
 * the graphic stays crisp at any zoom.
 */
function imageSvg(op: ImageOp): string {
  const scaleX = op.scaleX && op.scaleX > 0 ? op.scaleX : 1;
  const scaleY = op.scaleY && op.scaleY > 0 ? op.scaleY : 1;
  const inverted = op.invert ?? op.reverse;
  const parts: string[] = [];

  if (inverted) {
    parts.push(
      `<rect x="0" y="0" width="${round(op.width * scaleX)}" height="${round(op.height * scaleY)}" fill="${BLACK}"/>`,
    );
  }
  const fill = inverted ? WHITE : BLACK;

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
        parts.push(
          `<rect x="${round(runStart * scaleX)}" y="${round(row * scaleY)}" ` +
            `width="${round((col - runStart) * scaleX)}" height="${round(scaleY)}" fill="${fill}"/>`,
        );
        runStart = -1;
      }
    }
  }
  return parts.join('');
}

/**
 * Prepares an encoder's `<svg>` for embedding inside the label.
 *
 * A nested `<svg>` establishes its own viewport, and `width`/`height` default
 * to 100% *of the parent* — so an encoder that emits only a `viewBox` (bwip-js
 * does) would stretch its barcode across the entire label and centre it.
 * Pinning the viewport to the viewBox's own dimensions makes the symbol occupy
 * exactly the dots it encoded, at the field origin.
 */
export function embedSvg(markup: string): string {
  const openTag = /^\s*<svg\b([^>]*)>/i.exec(markup);
  if (!openTag) {
    return markup;
  }
  const viewBox = /viewBox\s*=\s*"([^"]+)"/i.exec(openTag[1]);
  if (!viewBox) {
    return markup;
  }
  const box = viewBox[1].trim().split(/[\s,]+/).map(Number);
  if (box.length !== 4 || !Number.isFinite(box[2]) || !Number.isFinite(box[3])) {
    return markup;
  }
  const attributes = openTag[1].replace(/\s(?:width|height|x|y)\s*=\s*"[^"]*"/gi, '');
  return markup.replace(
    openTag[0],
    `<svg${attributes} x="0" y="0" width="${round(box[2])}" height="${round(box[3])}">`,
  );
}

function barcodeSvg(op: BarcodeOp, barcodes?: BarcodeSvgRenderer): string {
  if (!barcodes) {
    return `<!-- barcode ${escapeXml(op.symbology)} omitted: no encoder available -->`;
  }
  try {
    return embedSvg(barcodes.render(op));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return (
      `<text x="0" y="0" font-family="monospace" font-size="12" fill="#cc0000" ` +
      `dominant-baseline="text-before-edge">barcode error: ${escapeXml(message)}</text>`
    );
  }
}

function opToSvg(op: Op, options: SvgOptions, fontFamily: string): string {
  switch (op.type) {
    case 'text':
      return textSvg(op, fontFamily);
    case 'box':
      return boxSvg(op);
    case 'line':
      return lineSvg(op);
    case 'diagonal':
      return diagonalSvg(op);
    case 'circle':
      return circleSvg(op);
    case 'ellipse':
      return ellipseSvg(op);
    case 'image':
      return imageSvg(op);
    case 'barcode':
      return barcodeSvg(op, options.barcodes);
    default:
      return '';
  }
}

/** Renders one label page as a standalone SVG document. */
export function pageToSvg(page: LabelPage, options: SvgOptions = {}): string {
  const fontFamily = options.fontFamily ?? 'Helvetica, Arial, sans-serif';
  const dpmm = options.dpmm ?? 8;
  const widthMm = round(page.width / dpmm);
  const heightMm = round(page.height / dpmm);

  const body = page.ops
    .map((op) => `${openGroup(op, page.homeX, page.homeY)}${opToSvg(op, options, fontFamily)}</g>`)
    .join('\n  ');

  const title = options.title ? `\n  <title>${escapeXml(options.title)}</title>` : '';

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" ` +
    `width="${widthMm}mm" height="${heightMm}mm" ` +
    `viewBox="0 0 ${page.width} ${page.height}">${title}\n` +
    `  <rect x="0" y="0" width="${page.width}" height="${page.height}" fill="${options.background ?? WHITE}"/>\n` +
    `  ${body}\n</svg>\n`
  );
}

/**
 * Renders every page of a label. Multi-page labels become one SVG per page —
 * SVG has no page model, and stacking labels into one canvas would misrepresent
 * what the printer does with them.
 */
export function pagesToSvg(pages: LabelPage[], options: SvgOptions = {}): string[] {
  return pages.map((page, index) =>
    pageToSvg(page, {
      ...options,
      title: options.title ? `${options.title} (page ${index + 1})` : undefined,
    }),
  );
}
