/**
 * Intermediate representation produced by the ZPL interpreter and consumed by
 * the canvas drawing routine. Coordinates are in printer dots (not pixels) and
 * follow ZPL conventions: origin is top-left, +x is right, +y is down.
 */

export type Rotation = 'N' | 'R' | 'I' | 'B';

export interface LabelPage {
  /** Width in dots. */
  width: number;
  /** Height in dots. */
  height: number;
  /** Drawing operations in order. */
  ops: Op[];
  /** Home offset applied to the page (set by ^LH). */
  homeX: number;
  homeY: number;
}

export interface RenderResult {
  /** Dots per millimeter (6, 8, 12, 24). */
  dpmm: number;
  /** Target width/height in inches. */
  widthInches: number;
  heightInches: number;
  /** One entry per `^XA … ^XZ` block found in the source. */
  pages: LabelPage[];
  /** Non-fatal warnings encountered during interpretation. */
  warnings: string[];
}

export type Op =
  | TextOp
  | BoxOp
  | LineOp
  | DiagonalOp
  | CircleOp
  | EllipseOp
  | BarcodeOp
  | ImageOp;

/** Character range in the source document that produced an op. */
export interface SourceSpan {
  start: number;
  end: number;
}

interface BaseOp {
  x: number;
  y: number;
  /** N=normal, R=90CW, I=180, B=270CW. */
  rotation: Rotation;
  /** If true, render in white on black background (^FR). */
  reverse: boolean;
  /**
   * Where this op came from in the source text. Set by the interpreters and
   * used to attach analysis findings to editor ranges; optional so
   * synthesized ops (templates, conversions) do not have to fake one.
   */
  source?: SourceSpan;
}

export interface TextOp extends BaseOp {
  type: 'text';
  data: string;
  font: string;
  /** Glyph height in dots. */
  fontHeight: number;
  /** Glyph width in dots. */
  fontWidth: number;
  /** Optional text block (^FB) configuration. */
  block?: {
    width: number;
    maxLines: number;
    lineSpacing: number;
    justification: 'L' | 'C' | 'R' | 'J';
    hangingIndent: number;
  };
}

export interface BoxOp extends BaseOp {
  type: 'box';
  width: number;
  height: number;
  thickness: number;
  color: 'B' | 'W';
  rounding: number;
}

export interface LineOp extends BaseOp {
  type: 'line';
  /** Same params as BoxOp with height==0 or width==0. */
  length: number;
  thickness: number;
  direction: 'horizontal' | 'vertical';
  color: 'B' | 'W';
}

export interface DiagonalOp extends BaseOp {
  type: 'diagonal';
  width: number;
  height: number;
  thickness: number;
  color: 'B' | 'W';
  /** L = \\ , R = / */
  orientation: 'L' | 'R';
}

export interface CircleOp extends BaseOp {
  type: 'circle';
  diameter: number;
  thickness: number;
  color: 'B' | 'W';
}

export interface EllipseOp extends BaseOp {
  type: 'ellipse';
  width: number;
  height: number;
  thickness: number;
  color: 'B' | 'W';
}

export type BarcodeSymbology =
  // Linear
  | 'code128'
  | 'gs1-128'
  | 'code39'
  | 'code93'
  | 'code11'
  | 'codabar'
  | 'interleaved2of5'
  | 'industrial2of5'
  | 'itf14'
  | 'msi'
  | 'plessey'
  | 'ean13'
  | 'ean8'
  | 'upca'
  | 'upce'
  | 'gs1databar'
  // Postal
  | 'postnet'
  | 'planet'
  // 2-D
  | 'qrcode'
  | 'datamatrix'
  | 'pdf417'
  | 'micropdf417'
  | 'aztec'
  | 'maxicode';

export interface BarcodeOp extends BaseOp {
  type: 'barcode';
  symbology: BarcodeSymbology;
  data: string;
  /** Narrow module width in dots. */
  moduleWidth: number;
  /** Ratio of wide/narrow (linear barcodes). */
  ratio: number;
  /** Bar height in dots. */
  height: number;
  /** Print human-readable interpretation line. */
  interpretation: boolean;
  /** Print interpretation above the barcode. */
  interpretationAbove: boolean;
  /** Magnification for 2-D codes (1-10). */
  magnification?: number;
  /** Error correction level for QR/PDF417. */
  errorCorrection?: string;
  /** Columns for 2-D codes. */
  columns?: number;
  /** Rows for 2-D codes. */
  rows?: number;
}

export interface ImageOp extends BaseOp {
  type: 'image';
  /** Width of the image in dots. */
  width: number;
  /** Height of the image in dots. */
  height: number;
  /** Raw monochrome bitmap. 1 bit per pixel, row-major. */
  bitmap: Uint8Array;
  /** Bytes per row (as declared in ^GF). */
  bytesPerRow: number;
}
