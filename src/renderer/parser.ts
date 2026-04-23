/**
 * ZPL II interpreter. Walks the stream of tokens produced by {@link tokenize}
 * and emits a {@link RenderResult} consisting of one page per `^XA … ^XZ`
 * block. The interpreter maintains drawing state (current field origin, font,
 * barcode defaults, …) and buffers a pending field until `^FS` is seen.
 */

import { tokenize, ZplToken } from '../zplParser';
import {
  BarcodeOp,
  BoxOp,
  CircleOp,
  DiagonalOp,
  EllipseOp,
  ImageOp,
  LabelPage,
  LineOp,
  RenderResult,
  Rotation,
  TextOp,
} from './ir';

export interface ParseOptions {
  /** Dots per millimeter for the target printer (used for scaling). */
  dpmm?: number;
  /** Label width in inches (defaults to ^PW if present, else 4 in). */
  widthInches?: number;
  /** Label height in inches (defaults to ^LL if present, else 6 in). */
  heightInches?: number;
}

interface PendingField {
  x: number;
  y: number;
  rotation: Rotation;
  reverse: boolean;
  data?: string;
  dataHex?: boolean;
  barcode?: Partial<BarcodeOp>;
  block?: TextOp['block'];
  image?: ImageOp;
  startToken: ZplToken;
}

interface State {
  // Label-home offsets (^LH).
  homeX: number;
  homeY: number;
  // Print width (^PW) + label length (^LL), in dots.
  printWidth?: number;
  labelLength?: number;
  // Current font/default font (^CF, ^A).
  defaultFont: string;
  defaultFontHeight: number;
  defaultFontWidth: number;
  currentFont?: { font: string; height: number; width: number };
  // Barcode defaults (^BY).
  barModuleWidth: number;
  barRatio: number;
  barHeight: number;
  // Current pending field (between ^FO/^FT and ^FS).
  field?: PendingField;
  // Global field orientation override (^FW).
  globalRotation: Rotation;
}

export function parseZpl(source: string, options: ParseOptions = {}): RenderResult {
  const dpmm = options.dpmm ?? 8;
  const defaultWidthIn = options.widthInches ?? 4;
  const defaultHeightIn = options.heightInches ?? 6;

  const warnings: string[] = [];
  const pages: LabelPage[] = [];
  const tokens = tokenize(source);

  let currentPage: LabelPage | undefined;
  let state: State = freshState();

  const startPage = (): void => {
    state = freshState();
    currentPage = {
      width: Math.round(defaultWidthIn * dpmm * 25.4),
      height: Math.round(defaultHeightIn * dpmm * 25.4),
      ops: [],
      homeX: 0,
      homeY: 0,
    };
  };

  const finishField = (): void => {
    if (!currentPage || !state.field) {
      return;
    }
    const f = state.field;
    const rotation = f.rotation;

    if (f.image) {
      currentPage.ops.push({
        ...f.image,
        x: f.x,
        y: f.y,
        rotation,
        reverse: f.reverse,
      });
      state.field = undefined;
      return;
    }

    if (f.barcode) {
      const bc: BarcodeOp = {
        type: 'barcode',
        symbology: f.barcode.symbology ?? 'code128',
        data: f.data ?? '',
        moduleWidth: f.barcode.moduleWidth ?? state.barModuleWidth,
        ratio: f.barcode.ratio ?? state.barRatio,
        height: f.barcode.height ?? state.barHeight,
        interpretation: f.barcode.interpretation ?? true,
        interpretationAbove: f.barcode.interpretationAbove ?? false,
        magnification: f.barcode.magnification,
        errorCorrection: f.barcode.errorCorrection,
        columns: f.barcode.columns,
        rows: f.barcode.rows,
        x: f.x,
        y: f.y,
        rotation,
        reverse: f.reverse,
      };
      currentPage.ops.push(bc);
      state.field = undefined;
      return;
    }

    if (typeof f.data === 'string') {
      const font =
        state.currentFont ?? {
          font: state.defaultFont,
          height: state.defaultFontHeight,
          width: state.defaultFontWidth,
        };
      const op: TextOp = {
        type: 'text',
        data: decodeFieldData(f.data, f.dataHex === true),
        font: font.font,
        fontHeight: font.height,
        fontWidth: font.width,
        x: f.x,
        y: f.y,
        rotation,
        reverse: f.reverse,
        block: f.block,
      };
      currentPage.ops.push(op);
      state.field = undefined;
      return;
    }

    warnings.push(
      `Field started at offset ${f.startToken.start} ended without any data.`,
    );
    state.field = undefined;
  };

  for (const token of tokens) {
    switch (token.command) {
      case '^XA':
        startPage();
        break;
      case '^XZ':
        if (currentPage) {
          if (state.field) {
            warnings.push('Label ended with an unterminated ^FD.');
            finishField();
          }
          if (state.printWidth !== undefined) {
            currentPage.width = state.printWidth;
          }
          if (state.labelLength !== undefined) {
            currentPage.height = state.labelLength;
          }
          currentPage.homeX = state.homeX;
          currentPage.homeY = state.homeY;
          pages.push(currentPage);
          currentPage = undefined;
        }
        break;
      case '^LH': {
        state.homeX = intArg(token, 0, 0);
        state.homeY = intArg(token, 1, 0);
        break;
      }
      case '^PW':
        state.printWidth = intArg(token, 0, state.printWidth ?? 0) || undefined;
        break;
      case '^LL':
        state.labelLength = intArg(token, 0, state.labelLength ?? 0) || undefined;
        break;
      case '^FO':
      case '^FT': {
        ensureField(state, token);
        state.field!.x = intArg(token, 0, 0);
        state.field!.y = intArg(token, 1, 0);
        break;
      }
      case '^FW': {
        const r = (token.args[0] ?? 'N').toUpperCase();
        if (r === 'N' || r === 'R' || r === 'I' || r === 'B') {
          state.globalRotation = r;
        }
        break;
      }
      case '^FR':
        ensureField(state, token);
        state.field!.reverse = true;
        break;
      case '^FH':
        ensureField(state, token);
        state.field!.dataHex = true;
        break;
      case '^FD': {
        ensureField(state, token);
        state.field!.data = token.raw;
        break;
      }
      case '^FB': {
        ensureField(state, token);
        state.field!.block = {
          width: intArg(token, 0, 0),
          maxLines: intArg(token, 1, 1),
          lineSpacing: intArg(token, 2, 0),
          justification: justificationArg(token, 3, 'L'),
          hangingIndent: intArg(token, 4, 0),
        };
        break;
      }
      case '^FS':
        finishField();
        break;
      case '^CF': {
        state.defaultFont = (token.args[0] ?? '0').toUpperCase() || '0';
        state.defaultFontHeight = intArg(token, 1, state.defaultFontHeight);
        state.defaultFontWidth = intArg(token, 2, state.defaultFontHeight);
        break;
      }
      case '^BY': {
        state.barModuleWidth = intArg(token, 0, state.barModuleWidth);
        state.barRatio = floatArg(token, 1, state.barRatio);
        state.barHeight = intArg(token, 2, state.barHeight);
        break;
      }
      case '^BC': {
        ensureField(state, token);
        state.field!.barcode = {
          symbology: 'code128',
          ...state.field!.barcode,
          height: intArg(token, 1, state.barHeight),
          interpretation: boolArg(token, 2, true),
          interpretationAbove: boolArg(token, 3, false),
        };
        applyBarcodeRotation(state.field!, token, 0);
        break;
      }
      case '^BQ': {
        ensureField(state, token);
        state.field!.barcode = {
          symbology: 'qrcode',
          ...state.field!.barcode,
          magnification: intArg(token, 2, 2),
          errorCorrection: (token.args[3] ?? 'Q').toUpperCase(),
        };
        applyBarcodeRotation(state.field!, token, 0);
        break;
      }
      case '^BX': {
        ensureField(state, token);
        state.field!.barcode = {
          symbology: 'datamatrix',
          ...state.field!.barcode,
          moduleWidth: intArg(token, 1, state.barModuleWidth),
          columns: intArg(token, 3, 0) || undefined,
          rows: intArg(token, 4, 0) || undefined,
        };
        applyBarcodeRotation(state.field!, token, 0);
        break;
      }
      case '^B3': {
        ensureField(state, token);
        state.field!.barcode = {
          symbology: 'code39',
          ...state.field!.barcode,
          height: intArg(token, 2, state.barHeight),
          interpretation: boolArg(token, 3, true),
          interpretationAbove: boolArg(token, 4, false),
        };
        applyBarcodeRotation(state.field!, token, 0);
        break;
      }
      case '^BE': {
        ensureField(state, token);
        state.field!.barcode = {
          symbology: 'ean13',
          ...state.field!.barcode,
          height: intArg(token, 1, state.barHeight),
          interpretation: boolArg(token, 2, true),
        };
        applyBarcodeRotation(state.field!, token, 0);
        break;
      }
      case '^BU': {
        ensureField(state, token);
        state.field!.barcode = {
          symbology: 'upca',
          ...state.field!.barcode,
          height: intArg(token, 1, state.barHeight),
          interpretation: boolArg(token, 2, true),
        };
        applyBarcodeRotation(state.field!, token, 0);
        break;
      }
      case '^B8': {
        ensureField(state, token);
        state.field!.barcode = {
          symbology: 'ean8',
          ...state.field!.barcode,
          height: intArg(token, 1, state.barHeight),
          interpretation: boolArg(token, 2, true),
        };
        applyBarcodeRotation(state.field!, token, 0);
        break;
      }
      case '^B7': {
        ensureField(state, token);
        state.field!.barcode = {
          symbology: 'pdf417',
          ...state.field!.barcode,
          height: intArg(token, 1, state.barHeight),
          errorCorrection: String(intArg(token, 2, 0)),
          rows: intArg(token, 3, 0) || undefined,
          columns: intArg(token, 4, 0) || undefined,
        };
        applyBarcodeRotation(state.field!, token, 0);
        break;
      }
      case '^B9': {
        ensureField(state, token);
        state.field!.barcode = {
          symbology: 'codabar',
          ...state.field!.barcode,
          height: intArg(token, 1, state.barHeight),
          interpretation: boolArg(token, 2, true),
        };
        applyBarcodeRotation(state.field!, token, 0);
        break;
      }
      case '^GB': {
        ensureField(state, token);
        const w = intArg(token, 0, 1);
        const h = intArg(token, 1, 1);
        const thickness = intArg(token, 2, 1);
        const color = colorArg(token, 3, 'B');
        const rounding = intArg(token, 4, 0);
        currentPage?.ops.push(boxOrLine(state.field!, w, h, thickness, color, rounding));
        // ^GB consumes the field without waiting for ^FD, so close it now.
        state.field = undefined;
        break;
      }
      case '^GC': {
        ensureField(state, token);
        const op: CircleOp = {
          type: 'circle',
          diameter: intArg(token, 0, 3),
          thickness: intArg(token, 1, 1),
          color: colorArg(token, 2, 'B'),
          x: state.field!.x,
          y: state.field!.y,
          rotation: state.field!.rotation,
          reverse: state.field!.reverse,
        };
        currentPage?.ops.push(op);
        state.field = undefined;
        break;
      }
      case '^GD': {
        ensureField(state, token);
        const op: DiagonalOp = {
          type: 'diagonal',
          width: intArg(token, 0, 3),
          height: intArg(token, 1, 3),
          thickness: intArg(token, 2, 1),
          color: colorArg(token, 3, 'B'),
          orientation: (token.args[4] ?? 'R').toUpperCase() === 'L' ? 'L' : 'R',
          x: state.field!.x,
          y: state.field!.y,
          rotation: state.field!.rotation,
          reverse: state.field!.reverse,
        };
        currentPage?.ops.push(op);
        state.field = undefined;
        break;
      }
      case '^GE': {
        ensureField(state, token);
        const op: EllipseOp = {
          type: 'ellipse',
          width: intArg(token, 0, 3),
          height: intArg(token, 1, 3),
          thickness: intArg(token, 2, 1),
          color: colorArg(token, 3, 'B'),
          x: state.field!.x,
          y: state.field!.y,
          rotation: state.field!.rotation,
          reverse: state.field!.reverse,
        };
        currentPage?.ops.push(op);
        state.field = undefined;
        break;
      }
      case '^GF': {
        ensureField(state, token);
        const image = parseGraphicField(token);
        if (image) {
          state.field!.image = image;
        } else {
          warnings.push('Failed to decode ^GF graphic field.');
        }
        break;
      }
      default: {
        // ^A commands (font selection) have the format ^A[font][rotation],[h],[w]
        // where [font] and [rotation] are single letters embedded in the token name.
        if (token.command.startsWith('^A') && token.command.length >= 2) {
          const after = token.command.slice(2);
          let font = '0';
          let rotation: Rotation = 'N';
          if (after.length >= 1) {
            font = after[0];
          }
          if (after.length >= 2 && 'NRIB'.includes(after[1])) {
            rotation = after[1] as Rotation;
          }
          // For forms like ^A0N,50,30 the raw text starts with a comma because
          // orientation is encoded in the command token itself.
          const argOffset = token.raw.startsWith(',') ? 1 : 0;
          const height = intArg(token, argOffset, state.defaultFontHeight);
          const width = intArg(token, argOffset + 1, height);
          state.currentFont = { font, height, width };
          if (state.field) {
            state.field.rotation = rotation;
          }
        }
        break;
      }
    }
  }

  return {
    dpmm,
    widthInches: defaultWidthIn,
    heightInches: defaultHeightIn,
    pages,
    warnings,
  };
}

function freshState(): State {
  return {
    homeX: 0,
    homeY: 0,
    defaultFont: '0',
    defaultFontHeight: 15,
    defaultFontWidth: 15,
    barModuleWidth: 2,
    barRatio: 3,
    barHeight: 10,
    globalRotation: 'N',
  };
}

function ensureField(state: State, token: ZplToken): void {
  if (!state.field) {
    state.field = {
      x: 0,
      y: 0,
      rotation: state.globalRotation,
      reverse: false,
      startToken: token,
    };
  }
}

function boxOrLine(
  field: PendingField,
  width: number,
  height: number,
  thickness: number,
  color: 'B' | 'W',
  rounding: number,
): BoxOp | LineOp {
  const minSide = Math.min(width, height);
  if (minSide <= thickness || width === 0 || height === 0) {
    const isHorizontal = width >= height;
    const line: LineOp = {
      type: 'line',
      length: isHorizontal ? width : height,
      thickness: thickness > 0 ? thickness : Math.max(1, minSide),
      direction: isHorizontal ? 'horizontal' : 'vertical',
      color,
      x: field.x,
      y: field.y,
      rotation: field.rotation,
      reverse: field.reverse,
    };
    return line;
  }
  return {
    type: 'box',
    width,
    height,
    thickness: Math.max(1, thickness),
    color,
    rounding: Math.max(0, Math.min(8, rounding)),
    x: field.x,
    y: field.y,
    rotation: field.rotation,
    reverse: field.reverse,
  };
}

function applyBarcodeRotation(
  field: PendingField,
  token: ZplToken,
  argIndex: number,
): void {
  const raw = (token.args[argIndex] ?? '').toUpperCase();
  if (raw === 'N' || raw === 'R' || raw === 'I' || raw === 'B') {
    field.rotation = raw;
  }
}

function intArg(token: ZplToken, index: number, fallback: number): number {
  const raw = token.args[index];
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function floatArg(token: ZplToken, index: number, fallback: number): number {
  const raw = token.args[index];
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

function boolArg(token: ZplToken, index: number, fallback: boolean): boolean {
  const raw = token.args[index];
  if (raw === undefined || raw === '') {
    return fallback;
  }
  return raw.toUpperCase() === 'Y';
}

function colorArg(
  token: ZplToken,
  index: number,
  fallback: 'B' | 'W',
): 'B' | 'W' {
  const raw = (token.args[index] ?? '').toUpperCase();
  return raw === 'W' ? 'W' : raw === 'B' ? 'B' : fallback;
}

function justificationArg(
  token: ZplToken,
  index: number,
  fallback: 'L' | 'C' | 'R' | 'J',
): 'L' | 'C' | 'R' | 'J' {
  const raw = (token.args[index] ?? '').toUpperCase();
  return raw === 'C' || raw === 'R' || raw === 'J' || raw === 'L' ? raw : fallback;
}

function decodeFieldData(raw: string, hexMode: boolean): string {
  if (!hexMode) {
    return raw;
  }
  return raw.replace(/_([0-9A-Fa-f]{2})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
}

/**
 * Parses a `^GF` graphic field. ZPL format:
 *   ^GFa,b,c,d,data
 *     a = compression type: A (ASCII hex), B (binary), C (compressed ASCII hex)
 *     b = binary byte count
 *     c = graphic field count (total bytes)
 *     d = bytes per row
 *     data = ASCII hex or binary blob
 *
 * This implementation supports the most common "A" (ASCII hex) form; other
 * compressions are left for future work but won't crash.
 */
function parseGraphicField(token: ZplToken): ImageOp | undefined {
  if (token.args.length < 5) {
    return undefined;
  }
  const compression = (token.args[0] ?? 'A').toUpperCase();
  const bytesPerRow = parseInt(token.args[3] ?? '0', 10);
  const data = token.args.slice(4).join(',');
  if (!bytesPerRow || !data) {
    return undefined;
  }
  let bytes: Uint8Array | undefined;
  if (compression === 'A') {
    bytes = hexToBytes(data.replace(/[^0-9A-Fa-f:,]/g, ''));
  } else if (compression === 'B') {
    const buf = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i += 1) {
      buf[i] = data.charCodeAt(i) & 0xff;
    }
    bytes = buf;
  }
  if (!bytes) {
    return undefined;
  }
  const totalBytes = bytes.length;
  const rows = Math.max(1, Math.floor(totalBytes / bytesPerRow));
  return {
    type: 'image',
    x: 0,
    y: 0,
    rotation: 'N',
    reverse: false,
    width: bytesPerRow * 8,
    height: rows,
    bitmap: bytes,
    bytesPerRow,
  };
}

function hexToBytes(hex: string): Uint8Array {
  // Support Labelary-style run-length encoding using `:` to repeat last byte.
  const clean = hex.replace(/\s+/g, '');
  const out: number[] = [];
  for (let i = 0; i < clean.length; i += 2) {
    const pair = clean.slice(i, i + 2);
    if (pair.length < 2) {
      break;
    }
    const n = parseInt(pair, 16);
    if (!Number.isNaN(n)) {
      out.push(n);
    }
  }
  return new Uint8Array(out);
}
