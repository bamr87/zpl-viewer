/**
 * EPL2 interpreter. Produces the same {@link RenderResult} IR as the ZPL
 * interpreter, so preview, export, analysis and conversion all work on EPL
 * documents without knowing which language they came from.
 *
 * A page runs from `N` (clear image buffer) to `P` (print); a document that
 * never issues `P` still yields its buffered page at end of input.
 */

import {
  BarcodeOp,
  BoxOp,
  ImageOp,
  LabelPage,
  LineOp,
  RenderResult,
  Rotation,
  TextOp,
} from '../../renderer/ir';
import { BarcodeSymbology } from '../../renderer/ir';
import { SYMBOLOGIES } from '../../barcode/symbologies';
import { EplToken, tokenizeEpl } from './tokenizer';

export interface EplParseOptions {
  dpmm?: number;
  widthInches?: number;
  heightInches?: number;
}

/** Font cell sizes (width x height in dots) for EPL fonts 1-5 at 203 dpi. */
const EPL_FONT_CELLS: Record<string, { width: number; height: number }> = {
  '1': { width: 8, height: 12 },
  '2': { width: 10, height: 16 },
  '3': { width: 12, height: 20 },
  '4': { width: 14, height: 24 },
  '5': { width: 32, height: 48 },
};

const EPL_LINEAR_CODES = new Map<string, BarcodeSymbology>();
const EPL_2D_CODES = new Map<string, BarcodeSymbology>();
for (const spec of SYMBOLOGIES) {
  if (spec.eplCode && !EPL_LINEAR_CODES.has(spec.eplCode)) {
    EPL_LINEAR_CODES.set(spec.eplCode.toUpperCase(), spec.id);
  }
  if (spec.epl2dCode && !EPL_2D_CODES.has(spec.epl2dCode)) {
    EPL_2D_CODES.set(spec.epl2dCode.toUpperCase(), spec.id);
  }
}

/**
 * Resolves an EPL barcode selector such as `3`, `0C`, `8+2` or `UA0`.
 * Variants only add a check digit or an add-on, which does not change which
 * symbology is being printed.
 */
export function symbologyForEplCode(
  code: string,
): BarcodeSymbology | undefined {
  const raw = code.trim().toUpperCase();
  if (EPL_LINEAR_CODES.has(raw)) {
    return EPL_LINEAR_CODES.get(raw);
  }
  const withoutAddon = raw.split('+')[0];
  if (EPL_LINEAR_CODES.has(withoutAddon)) {
    return EPL_LINEAR_CODES.get(withoutAddon);
  }
  const base = withoutAddon.replace(/[BC]$/, '');
  return EPL_LINEAR_CODES.get(base);
}

export function symbologyForEpl2dCode(
  code: string,
): BarcodeSymbology | undefined {
  return EPL_2D_CODES.get(code.trim().toUpperCase());
}

function rotationOf(value: string | undefined): Rotation {
  switch ((value ?? '0').trim()) {
    case '1':
      return 'R';
    case '2':
      return 'I';
    case '3':
      return 'B';
    default:
      return 'N';
  }
}

function intArg(token: EplToken, index: number, fallback: number): number {
  const raw = token.args[index];
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Reads a raw `GW` payload into the IR's bitmap convention.
 *
 * EPL and ZPL disagree about polarity: a `GW` bit that is 0 burns a dot, while
 * the IR (like ZPL's `^GF`) treats a set bit as ink. Inverting here keeps one
 * convention below the parsers, so the renderer, the metrics and the emitters
 * do not each have to remember which language a graphic came from.
 */
function bytesFromRaw(data: string): Uint8Array {
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i += 1) {
    out[i] = ~data.charCodeAt(i) & 0xff;
  }
  return out;
}

interface EplState {
  homeX: number;
  homeY: number;
  width?: number;
  height?: number;
}

export function parseEpl(
  source: string,
  options: EplParseOptions = {},
): RenderResult {
  const dpmm = options.dpmm ?? 8;
  const defaultWidthIn = options.widthInches ?? 4;
  const defaultHeightIn = options.heightInches ?? 6;
  /** EPL font cells are quoted at 203 dpi; scale them for denser heads. */
  const fontScale = dpmm / 8;

  const warnings: string[] = [];
  const pages: LabelPage[] = [];
  const tokens = tokenizeEpl(source);

  let state: EplState = { homeX: 0, homeY: 0 };
  let ops: LabelPage['ops'] = [];
  let touched = false;

  const newPage = (): void => {
    state = { homeX: 0, homeY: 0, width: state.width, height: state.height };
    ops = [];
    touched = false;
  };

  const flushPage = (): void => {
    if (!touched && ops.length === 0) {
      return;
    }
    pages.push({
      width: state.width ?? Math.round(defaultWidthIn * dpmm * 25.4),
      height: state.height ?? Math.round(defaultHeightIn * dpmm * 25.4),
      ops,
      homeX: state.homeX,
      homeY: state.homeY,
    });
    newPage();
  };

  for (const token of tokens) {
    switch (token.name) {
      case 'N':
        // Clearing the buffer starts a new label; anything buffered before it
        // was never printed, but keeping it makes stray output visible.
        flushPage();
        newPage();
        break;
      case 'P':
        flushPage();
        break;
      case 'q':
        state.width = intArg(token, 0, state.width ?? 0) || state.width;
        break;
      case 'Q':
        state.height = intArg(token, 0, state.height ?? 0) || state.height;
        break;
      case 'R':
        state.homeX = intArg(token, 0, 0);
        state.homeY = intArg(token, 1, 0);
        break;
      case 'A': {
        const font = (token.args[3] ?? '3').trim();
        const cell = EPL_FONT_CELLS[font] ?? EPL_FONT_CELLS['3'];
        const hMult = Math.max(1, intArg(token, 4, 1));
        const vMult = Math.max(1, intArg(token, 5, 1));
        const op: TextOp = {
          type: 'text',
          data: token.data ?? '',
          font,
          fontHeight: Math.round(cell.height * vMult * fontScale),
          fontWidth: Math.round(cell.width * hMult * fontScale),
          x: intArg(token, 0, 0),
          y: intArg(token, 1, 0),
          rotation: rotationOf(token.args[2]),
          reverse: (token.args[6] ?? 'N').trim().toUpperCase() === 'R',
          source: { start: token.start, end: token.end },
        };
        ops.push(op);
        touched = true;
        break;
      }
      case 'B': {
        const code = token.args[3] ?? '3';
        const symbology = symbologyForEplCode(code);
        if (!symbology) {
          warnings.push(
            `Line ${token.line + 1}: unknown EPL barcode selector "${code}".`,
          );
        }
        const op: BarcodeOp = {
          type: 'barcode',
          symbology: symbology ?? 'code128',
          data: token.data ?? '',
          moduleWidth: Math.max(1, intArg(token, 4, 2)),
          ratio: Math.max(2, intArg(token, 5, 6)) / Math.max(1, intArg(token, 4, 2)),
          height: Math.max(1, intArg(token, 6, 50)),
          interpretation: (token.args[7] ?? 'B').trim().toUpperCase() === 'B',
          interpretationAbove: false,
          x: intArg(token, 0, 0),
          y: intArg(token, 1, 0),
          rotation: rotationOf(token.args[2]),
          reverse: false,
          source: { start: token.start, end: token.end },
        };
        ops.push(op);
        touched = true;
        break;
      }
      case 'b': {
        const type = token.args[2] ?? 'Q';
        const symbology = symbologyForEpl2dCode(type);
        if (!symbology) {
          warnings.push(
            `Line ${token.line + 1}: unknown EPL 2-D barcode type "${type}".`,
          );
        }
        let magnification: number | undefined;
        let errorCorrection: string | undefined;
        for (const arg of token.args.slice(3)) {
          const option = arg.trim();
          if (/^s\d+$/i.test(option)) {
            magnification = parseInt(option.slice(1), 10);
          } else if (/^e[LMQH]$/i.test(option)) {
            errorCorrection = option.slice(1).toUpperCase();
          }
        }
        const op: BarcodeOp = {
          type: 'barcode',
          symbology: symbology ?? 'qrcode',
          data: token.data ?? '',
          moduleWidth: magnification ?? 4,
          ratio: 3,
          height: 0,
          interpretation: false,
          interpretationAbove: false,
          magnification: magnification ?? 4,
          errorCorrection,
          x: intArg(token, 0, 0),
          y: intArg(token, 1, 0),
          rotation: 'N',
          reverse: false,
          source: { start: token.start, end: token.end },
        };
        ops.push(op);
        touched = true;
        break;
      }
      case 'X': {
        const x = intArg(token, 0, 0);
        const y = intArg(token, 1, 0);
        const thickness = Math.max(1, intArg(token, 2, 1));
        const x2 = intArg(token, 3, x);
        const y2 = intArg(token, 4, y);
        const op: BoxOp = {
          type: 'box',
          width: Math.max(1, x2 - x),
          height: Math.max(1, y2 - y),
          thickness,
          color: 'B',
          rounding: 0,
          x,
          y,
          rotation: 'N',
          reverse: false,
          source: { start: token.start, end: token.end },
        };
        ops.push(op);
        touched = true;
        break;
      }
      case 'LO':
      case 'LE':
      case 'LW': {
        // EPL line commands fill a rectangle rather than stroking an outline.
        const width = Math.max(1, intArg(token, 2, 1));
        const height = Math.max(1, intArg(token, 3, 1));
        const op: LineOp = {
          type: 'line',
          length: width,
          thickness: height,
          direction: 'horizontal',
          color: token.name === 'LO' ? 'B' : 'W',
          x: intArg(token, 0, 0),
          y: intArg(token, 1, 0),
          rotation: 'N',
          reverse: false,
          source: { start: token.start, end: token.end },
        };
        ops.push(op);
        touched = true;
        break;
      }
      case 'GW': {
        const bytesPerRow = Math.max(1, intArg(token, 2, 1));
        const rows = Math.max(1, intArg(token, 3, 1));
        // Everything after the fourth comma is raw image data, commas included.
        const dataStart = nthCommaIndex(token.raw, 4);
        const raw = dataStart >= 0 ? token.raw.slice(dataStart + 1) : '';
        if (raw.length === 0) {
          warnings.push(`Line ${token.line + 1}: GW has no image data.`);
          break;
        }
        const op: ImageOp = {
          type: 'image',
          width: bytesPerRow * 8,
          height: rows,
          bitmap: bytesFromRaw(raw),
          bytesPerRow,
          x: intArg(token, 0, 0),
          y: intArg(token, 1, 0),
          rotation: 'N',
          reverse: false,
          source: { start: token.start, end: token.end },
        };
        ops.push(op);
        touched = true;
        break;
      }
      default:
        break;
    }
  }

  flushPage();

  return {
    dpmm,
    widthInches: defaultWidthIn,
    heightInches: defaultHeightIn,
    pages,
    warnings,
  };
}

function nthCommaIndex(text: string, n: number): number {
  let index = -1;
  for (let i = 0; i < n; i += 1) {
    index = text.indexOf(',', index + 1);
    if (index < 0) {
      return -1;
    }
  }
  return index;
}
