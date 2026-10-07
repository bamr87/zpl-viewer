/**
 * ZPL II interpreter. Walks the stream of tokens produced by {@link tokenize}
 * and emits a {@link RenderResult} consisting of one page per `^XA … ^XZ`
 * block. The interpreter maintains drawing state (current field origin, font,
 * barcode defaults, …) and buffers a pending field until `^FS` is seen.
 */

import { tokenize, ZplToken } from '../zplParser';
import { symbologyForZplCommand } from '../barcode/symbologies';
import {
  decodeGraphicData,
  GraphicStore,
  normalizeGraphicName,
  StoredGraphic,
} from './graphics';
import { decodeImage, isSupportedImage } from '../image/decode';
import { toMonochrome } from '../image/bitmap';
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
  // Downloaded graphics live in printer memory, so the store outlives the
  // individual `^XA … ^XZ` labels that recall them.
  const graphics: GraphicStore = new Map();

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

  const finishField = (endToken?: ZplToken): void => {
    if (!currentPage || !state.field) {
      return;
    }
    const f = state.field;
    const rotation = f.rotation;
    const source = {
      start: f.startToken.start,
      end: endToken?.end ?? f.startToken.end,
    };

    if (f.image) {
      currentPage.ops.push({
        ...f.image,
        x: f.x,
        y: f.y,
        rotation,
        reverse: f.reverse,
        source,
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
        source,
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
        source,
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
        finishField(token);
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
      case '^GB': {
        ensureField(state, token);
        const w = intArg(token, 0, 1);
        const h = intArg(token, 1, 1);
        const thickness = intArg(token, 2, 1);
        const color = colorArg(token, 3, 'B');
        const rounding = intArg(token, 4, 0);
        currentPage?.ops.push({
          ...boxOrLine(state.field!, w, h, thickness, color, rounding),
          source: { start: state.field!.startToken.start, end: token.end },
        });
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
          source: { start: state.field!.startToken.start, end: token.end },
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
          source: { start: state.field!.startToken.start, end: token.end },
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
          source: { start: state.field!.startToken.start, end: token.end },
        };
        currentPage?.ops.push(op);
        state.field = undefined;
        break;
      }
      case '^GF': {
        ensureField(state, token);
        const image = parseGraphicField(token, warnings);
        if (image) {
          state.field!.image = image;
        } else {
          warnings.push('Failed to decode ^GF graphic field.');
        }
        break;
      }
      case '~DG':
      case '~DY': {
        const stored = parseDownloadGraphic(token, warnings);
        if (stored) {
          graphics.set(stored.name, stored);
        }
        break;
      }
      case '^ID': {
        // Delete object from storage. Wildcards delete everything matching.
        const target = normalizeGraphicName(token.args[0] ?? '');
        if (target === '' || target.includes('*')) {
          graphics.clear();
        } else {
          graphics.delete(target);
        }
        break;
      }
      case '^XG':
      case '^IM': {
        ensureField(state, token);
        const name = normalizeGraphicName(token.args[0] ?? '');
        const stored = graphics.get(name);
        if (!stored) {
          warnings.push(
            `${token.command} refers to graphic "${token.args[0] ?? ''}", which was never downloaded in this file.`,
          );
          state.field = undefined;
          break;
        }
        // ^XG magnifies (1-10); ^IM always places the graphic at 1:1.
        const scaleX = token.command === '^XG' ? clampMagnification(intArg(token, 1, 1)) : 1;
        const scaleY = token.command === '^XG' ? clampMagnification(intArg(token, 2, 1)) : 1;
        const op: ImageOp = {
          type: 'image',
          x: state.field!.x,
          y: state.field!.y,
          rotation: state.field!.rotation,
          reverse: state.field!.reverse,
          width: stored.bytesPerRow * 8,
          height: stored.rows,
          bitmap: stored.bytes,
          bytesPerRow: stored.bytesPerRow,
          scaleX,
          scaleY,
          sourceName: stored.name,
          source: { start: state.field!.startToken.start, end: token.end },
        };
        currentPage?.ops.push(op);
        // Both commands draw immediately; a trailing ^FS is optional.
        state.field = undefined;
        break;
      }
      default: {
        const layout = ZPL_BARCODE_LAYOUTS[token.command];
        if (layout) {
          ensureField(state, token);
          applyBarcodeLayout(state, token, layout);
          break;
        }
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

/**
 * Argument layout of every linear/postal ZPL barcode command. ZPL puts the
 * same conceptual parameter at a different index per command, so the index of
 * each one is declared here rather than repeated in a dozen switch arms. The
 * symbology itself comes from the shared barcode catalog, which also drives
 * validation, emission and the bwip-js renderer.
 *
 * `^BQ` (QR), `^BX` (Data Matrix) and `^B7` (PDF417) keep dedicated handling
 * above: their parameters are 2-D specific rather than height/interpretation.
 */
interface ZplBarcodeLayout {
  command: string;
  height?: number;
  interpretation?: number;
  interpretationAbove?: number;
  magnification?: number;
}

const ZPL_BARCODE_LAYOUTS: Record<string, ZplBarcodeLayout> = {
  // orientation, height, interpretation line, line above
  '^BC': { command: '^BC', height: 1, interpretation: 2, interpretationAbove: 3 },
  '^BA': { command: '^BA', height: 1, interpretation: 2, interpretationAbove: 3 },
  '^B2': { command: '^B2', height: 1, interpretation: 2, interpretationAbove: 3 },
  '^BI': { command: '^BI', height: 1, interpretation: 2, interpretationAbove: 3 },
  '^BJ': { command: '^BJ', height: 1, interpretation: 2, interpretationAbove: 3 },
  '^BE': { command: '^BE', height: 1, interpretation: 2, interpretationAbove: 3 },
  '^B8': { command: '^B8', height: 1, interpretation: 2, interpretationAbove: 3 },
  '^BU': { command: '^BU', height: 1, interpretation: 2, interpretationAbove: 3 },
  '^B9': { command: '^B9', height: 1, interpretation: 2, interpretationAbove: 3 },
  '^BZ': { command: '^BZ', height: 1, interpretation: 2, interpretationAbove: 3 },
  '^B5': { command: '^B5', height: 1, interpretation: 2, interpretationAbove: 3 },
  '^BF': { command: '^BF', height: 1 },
  // orientation, check digit, height, interpretation line, line above
  '^B3': { command: '^B3', height: 2, interpretation: 3, interpretationAbove: 4 },
  '^B1': { command: '^B1', height: 2, interpretation: 3, interpretationAbove: 4 },
  '^BK': { command: '^BK', height: 2, interpretation: 3, interpretationAbove: 4 },
  '^BM': { command: '^BM', height: 2, interpretation: 3, interpretationAbove: 4 },
  '^BP': { command: '^BP', height: 2, interpretation: 3, interpretationAbove: 4 },
  // orientation, symbology type, magnification, separator height, height
  '^BR': { command: '^BR', magnification: 2, height: 4 },
  // orientation, magnification
  '^BO': { command: '^BO', magnification: 1 },
  // mode, symbol number, total symbols - no orientation argument
  '^BD': { command: '^BD' },
};

function applyBarcodeLayout(
  state: State,
  token: ZplToken,
  layout: ZplBarcodeLayout,
): void {
  const field = state.field;
  if (!field) {
    return;
  }
  const spec = symbologyForZplCommand(layout.command);
  field.barcode = {
    symbology: spec?.id ?? 'code128',
    ...field.barcode,
    height:
      layout.height === undefined
        ? state.barHeight
        : intArg(token, layout.height, state.barHeight),
    interpretation:
      layout.interpretation === undefined
        ? false
        : boolArg(token, layout.interpretation, true),
    interpretationAbove:
      layout.interpretationAbove === undefined
        ? false
        : boolArg(token, layout.interpretationAbove, false),
    magnification:
      layout.magnification === undefined
        ? undefined
        : intArg(token, layout.magnification, 2),
  };
  if (layout.command !== '^BD') {
    applyBarcodeRotation(field, token, 0);
  }
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

function clampMagnification(value: number): number {
  if (!Number.isFinite(value) || value < 1) {
    return 1;
  }
  return Math.min(10, Math.floor(value));
}

/**
 * Parses a `^GF` graphic field:
 *   ^GFa,b,c,d,data
 *     a = compression: A (ASCII hex, optionally ACS-compressed), B (binary),
 *         C (compressed ASCII hex — identical to A for decoding purposes)
 *     b = binary byte count
 *     c = graphic field count (total bytes)
 *     d = bytes per row
 *     data = hex, binary, or a `:B64:`/`:Z64:` wrapper
 */
function parseGraphicField(
  token: ZplToken,
  warnings: string[],
): ImageOp | undefined {
  if (token.args.length < 5) {
    return undefined;
  }
  const bytesPerRow = parseInt(token.args[3] ?? '0', 10);
  // The payload may itself contain commas (ACS rows always do), so everything
  // past the four header parameters is data.
  const data = token.args.slice(4).join(',');
  if (!bytesPerRow || !data) {
    return undefined;
  }

  const decoded = decodeGraphicData({
    compression: token.args[0] ?? 'A',
    data,
    bytesPerRow,
    totalBytes: parseInt(token.args[2] ?? '0', 10) || undefined,
  });
  warnings.push(...decoded.warnings);

  return {
    type: 'image',
    x: 0,
    y: 0,
    rotation: 'N',
    reverse: false,
    width: decoded.bytesPerRow * 8,
    height: decoded.rows,
    bitmap: decoded.bytes,
    bytesPerRow: decoded.bytesPerRow,
  };
}

/**
 * Parses `~DG` and `~DY`, which download a graphic into printer memory for a
 * later `^XG` / `^IM` to draw.
 *
 *   ~DGd:o.x,t,w,data     — always a raw .GRF bitmap
 *   ~DYd:f,b,x,t,w,data   — `x` names the stored format, so the payload may be
 *                           a .GRF bitmap or a whole PNG file
 */
function parseDownloadGraphic(
  token: ZplToken,
  warnings: string[],
): StoredGraphic | undefined {
  const rawName = token.args[0] ?? '';
  const name = normalizeGraphicName(rawName);
  if (!name) {
    return undefined;
  }

  if (token.command === '~DG') {
    const totalBytes = parseInt(token.args[1] ?? '0', 10) || 0;
    const bytesPerRow = parseInt(token.args[2] ?? '0', 10) || 0;
    if (!bytesPerRow) {
      warnings.push(`~DG${rawName} declares no bytes per row; skipping it.`);
      return undefined;
    }
    const decoded = decodeGraphicData({
      compression: 'A',
      data: token.args.slice(3).join(','),
      bytesPerRow,
      totalBytes,
    });
    warnings.push(...decoded.warnings);
    return {
      name,
      bytes: decoded.bytes,
      bytesPerRow: decoded.bytesPerRow,
      rows: decoded.rows,
    };
  }

  const storedFormat = (token.args[2] ?? 'G').toUpperCase();
  const totalBytes = parseInt(token.args[3] ?? '0', 10) || 0;
  const bytesPerRow = parseInt(token.args[4] ?? '0', 10) || 0;
  const payload = token.args.slice(5).join(',');

  if (storedFormat === 'G' || storedFormat === 'B') {
    if (!bytesPerRow) {
      warnings.push(`~DY${rawName} declares no bytes per row; skipping it.`);
      return undefined;
    }
    const decoded = decodeGraphicData({
      compression: token.args[1] ?? 'A',
      data: payload,
      bytesPerRow,
      totalBytes,
    });
    warnings.push(...decoded.warnings);
    return {
      name,
      bytes: decoded.bytes,
      bytesPerRow: decoded.bytesPerRow,
      rows: decoded.rows,
    };
  }

  // A stored image file — PNG on every printer that accepts one. The bytes
  // arrive through the same B64/Z64/hex envelope as a bitmap would, so unwrap
  // the envelope first and hand the file itself to the image decoder.
  const envelope = decodeGraphicData({
    compression: token.args[1] ?? 'A',
    data: payload,
    bytesPerRow: 1,
    totalBytes,
  });
  warnings.push(...envelope.warnings);
  if (!isSupportedImage(envelope.bytes)) {
    warnings.push(
      `~DY${rawName} stores a "${storedFormat}" image this preview cannot decode.`,
    );
    return undefined;
  }
  try {
    const mono = toMonochrome(decodeImage(envelope.bytes), {
      threshold: 128,
      dither: 'none',
    });
    return {
      name,
      bytes: mono.data,
      bytesPerRow: mono.bytesPerRow,
      rows: mono.height,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    warnings.push(`~DY${rawName} could not be decoded (${message}).`);
    return undefined;
  }
}
