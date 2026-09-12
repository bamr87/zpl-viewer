/**
 * Decoding of ZPL graphic payloads: `^GF` fields, `~DG`/`~DY` downloads and the
 * `^XG` recalls that draw them.
 *
 * Zebra ships four ways of spelling the same monochrome bitmap and real labels
 * use all of them:
 *   - plain ASCII hex,
 *   - the "alternative data compression scheme" (ACS) that folds runs of
 *     identical nibbles into letter counts and whole rows into `,` `!` `:`,
 *   - `:B64:` — base64 of the raw bytes,
 *   - `:Z64:` — base64 of the zlib-compressed bytes, which is what every
 *     modern label generator emits.
 * Decoding is deliberately forgiving: a graphic that is truncated or carries a
 * bad CRC still renders as far as it can, with a warning, because a partial
 * logo is far more useful than a blank label when you are debugging a capture.
 */

import { base64Decode } from '../core/base64';
import { inflate } from '../core/inflate';

export interface DecodedGraphic {
  bytes: Uint8Array;
  bytesPerRow: number;
  rows: number;
  warnings: string[];
}

/** A bitmap held in printer memory by `~DG`/`~DY`, recalled by `^XG`. */
export interface StoredGraphic {
  name: string;
  bytes: Uint8Array;
  bytesPerRow: number;
  rows: number;
}

export type GraphicStore = Map<string, StoredGraphic>;

/**
 * Normalizes a printer memory path to a store key: `R:LOGO.GRF`, `logo.grf`
 * and `LOGO` all name the same graphic. ZPL memory letters (R:, E:, B:, A:)
 * select a storage device, not a namespace, so they are dropped.
 */
export function normalizeGraphicName(raw: string): string {
  let name = raw.trim().toUpperCase();
  const device = /^[A-Z]:(.*)$/.exec(name);
  if (device) {
    name = device[1];
  }
  return name.replace(/\.(GRF|PNG|BMP)$/, '');
}

/** CRC-16/XMODEM: poly 0x1021, init 0x0000, no reflection. */
function crc16Xmodem(text: string, initial: number): number {
  let crc = initial;
  for (let i = 0; i < text.length; i += 1) {
    crc ^= (text.charCodeAt(i) & 0xff) << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc & 0xffff;
}

/**
 * Repeat count for an ACS letter: G-Y count 1-19, g-z count in twenties
 * (20-400). Counts combine, so `hG` is 41 repeats of the next nibble.
 */
function repeatCount(ch: string): number {
  if (ch >= 'G' && ch <= 'Y') {
    return ch.charCodeAt(0) - 0x46; // 'G' -> 1
  }
  if (ch >= 'g' && ch <= 'z') {
    return (ch.charCodeAt(0) - 0x66) * 20; // 'g' -> 20
  }
  return 0;
}

function isHexDigit(ch: string): boolean {
  return (
    (ch >= '0' && ch <= '9') ||
    (ch >= 'A' && ch <= 'F') ||
    (ch >= 'a' && ch <= 'f')
  );
}

function nibblesToBytes(rows: string[], bytesPerRow: number): Uint8Array {
  const out = new Uint8Array(rows.length * bytesPerRow);
  for (let r = 0; r < rows.length; r += 1) {
    const row = rows[r];
    for (let b = 0; b < bytesPerRow; b += 1) {
      const hi = row[b * 2];
      const lo = row[b * 2 + 1];
      if (hi === undefined) {
        break;
      }
      const value = parseInt(hi + (lo ?? '0'), 16);
      out[r * bytesPerRow + b] = Number.isNaN(value) ? 0 : value;
    }
  }
  return out;
}

/**
 * Expands ASCII-hex graphic data, with or without ACS compression, into bytes.
 * Row-aware by necessity: `,`, `!` and `:` are defined relative to the current
 * row, so the decoder has to know how wide a row is.
 */
export function decodeAsciiHexGraphic(
  data: string,
  bytesPerRow: number,
): { bytes: Uint8Array; rows: number } {
  const rowNibbles = Math.max(2, bytesPerRow * 2);
  const rows: string[] = [];
  let current = '';
  let pendingCount = 0;
  // True when the last row ended because it filled up rather than because a
  // terminator said so, which makes a terminator that follows redundant: data
  // that both fills its rows and separates them must not produce blank rows.
  let rowJustFilled = false;

  const flush = (row: string): void => {
    rows.push(row.length >= rowNibbles ? row.slice(0, rowNibbles) : row.padEnd(rowNibbles, '0'));
    current = '';
  };

  for (let i = 0; i < data.length; i += 1) {
    const ch = data[i];

    if (ch === ' ' || ch === '\r' || ch === '\n' || ch === '\t') {
      continue;
    }

    if (ch === ',') {
      // Fill the rest of the row with zeros.
      if (!rowJustFilled) {
        flush(current);
      }
      rowJustFilled = false;
      pendingCount = 0;
      continue;
    }
    if (ch === '!') {
      // Fill the rest of the row with ones.
      if (!rowJustFilled) {
        flush(current.padEnd(rowNibbles, 'F'));
      }
      rowJustFilled = false;
      pendingCount = 0;
      continue;
    }
    if (ch === ':') {
      // Repeat the previous row.
      if (current.length > 0) {
        flush(current);
      }
      rows.push(rows.length > 0 ? rows[rows.length - 1] : '0'.repeat(rowNibbles));
      rowJustFilled = false;
      pendingCount = 0;
      continue;
    }

    const count = repeatCount(ch);
    if (count > 0) {
      pendingCount += count;
      continue;
    }

    if (!isHexDigit(ch)) {
      pendingCount = 0;
      continue;
    }

    const repeats = pendingCount > 0 ? pendingCount : 1;
    pendingCount = 0;
    rowJustFilled = false;
    for (let n = 0; n < repeats; n += 1) {
      current += ch.toUpperCase();
      if (current.length >= rowNibbles) {
        flush(current);
        rowJustFilled = true;
      }
    }
  }

  if (current.length > 0) {
    flush(current);
  }

  return { bytes: nibblesToBytes(rows, bytesPerRow), rows: rows.length };
}

/**
 * Decodes a `:B64:`/`:Z64:` wrapper. Returns undefined when the text is not one
 * of those encodings, so callers can fall through to the hex decoder.
 */
function decodeBase64Wrapper(
  data: string,
  warnings: string[],
): Uint8Array | undefined {
  const match = /:(B64|Z64):([^:]*)(?::([0-9A-Fa-f]{1,4}))?/.exec(data);
  if (!match) {
    return undefined;
  }
  const scheme = match[1].toUpperCase();
  const payload = match[2].replace(/\s+/g, '');
  const declaredCrc = match[3];

  if (declaredCrc !== undefined) {
    const expected = parseInt(declaredCrc, 16);
    // Zebra documents "the CRC-16 of the encoded data"; tools in the wild use
    // both of the common CCITT seeds, so accept either rather than cry wolf.
    const matches =
      crc16Xmodem(payload, 0x0000) === expected ||
      crc16Xmodem(payload, 0xffff) === expected;
    if (!matches) {
      warnings.push(
        `Graphic CRC mismatch (declared ${declaredCrc}); the data may be truncated.`,
      );
    }
  }

  const raw = base64Decode(payload);
  if (scheme === 'B64') {
    return raw;
  }
  try {
    return inflate(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    warnings.push(`Failed to decompress a :Z64: graphic (${message}).`);
    return undefined;
  }
}

export interface GraphicDataInput {
  /** Compression letter from the command (A, B or C); ignored for B64/Z64. */
  compression: string;
  /** Everything after the last comma of the command header. */
  data: string;
  /** Bytes per row, as declared by the command. */
  bytesPerRow: number;
  /** Total byte count, as declared by the command (0 when unknown). */
  totalBytes?: number;
}

/**
 * Decodes any ZPL graphic payload to a packed 1-bit-per-pixel bitmap.
 * The row count comes from the declared total byte count when it is present and
 * plausible, and from the decoded length otherwise — captures routinely declare
 * one and deliver the other.
 */
export function decodeGraphicData(input: GraphicDataInput): DecodedGraphic {
  const warnings: string[] = [];
  const bytesPerRow = Math.max(1, Math.floor(input.bytesPerRow));
  const compression = (input.compression || 'A').toUpperCase();

  let bytes: Uint8Array | undefined = decodeBase64Wrapper(input.data, warnings);

  if (!bytes) {
    if (compression === 'B') {
      const buf = new Uint8Array(input.data.length);
      for (let i = 0; i < input.data.length; i += 1) {
        buf[i] = input.data.charCodeAt(i) & 0xff;
      }
      bytes = buf;
    } else {
      bytes = decodeAsciiHexGraphic(input.data, bytesPerRow).bytes;
    }
  }

  const declaredRows =
    input.totalBytes && input.totalBytes > 0
      ? Math.round(input.totalBytes / bytesPerRow)
      : 0;
  const decodedRows = Math.floor(bytes.length / bytesPerRow);
  let rows = declaredRows > 0 ? declaredRows : decodedRows;

  if (rows <= 0) {
    rows = Math.max(1, decodedRows);
  }

  const needed = rows * bytesPerRow;
  if (bytes.length < needed) {
    if (decodedRows > 0 && declaredRows > 0 && decodedRows < declaredRows) {
      warnings.push(
        `Graphic declares ${declaredRows} rows but only ${decodedRows} were decoded; the rest is blank.`,
      );
    }
    const padded = new Uint8Array(needed);
    padded.set(bytes.subarray(0, Math.min(bytes.length, needed)));
    bytes = padded;
  } else if (bytes.length > needed) {
    bytes = bytes.subarray(0, needed);
  }

  return { bytes, bytesPerRow, rows, warnings };
}

/** Encodes a bitmap as ACS-compressed ASCII hex, the form `^GFA` expects. */
export function encodeAsciiHexGraphic(
  bytes: Uint8Array,
  bytesPerRow: number,
): string {
  const rows = Math.floor(bytes.length / Math.max(1, bytesPerRow));
  const out: string[] = [];
  let previousRow = '';

  for (let r = 0; r < rows; r += 1) {
    let row = '';
    for (let b = 0; b < bytesPerRow; b += 1) {
      row += bytes[r * bytesPerRow + b].toString(16).toUpperCase().padStart(2, '0');
    }

    if (row === previousRow) {
      out.push(':');
      continue;
    }
    previousRow = row;

    // Trailing runs of 0 or F compress to a single `,` or `!`.
    const trailing = /^(.*?)(0+|F+)$/.exec(row);
    let body = row;
    let terminator = '';
    if (trailing && trailing[2].length > 1) {
      body = trailing[1];
      terminator = trailing[2][0] === '0' ? ',' : '!';
    }

    let encoded = '';
    let index = 0;
    while (index < body.length) {
      const ch = body[index];
      let run = 1;
      while (index + run < body.length && body[index + run] === ch) {
        run += 1;
      }
      index += run;
      encoded += encodeRun(ch, run);
    }
    out.push(encoded + terminator);
  }

  return out.join('');
}

function encodeRun(ch: string, run: number): string {
  let remaining = run;
  let encoded = '';
  while (remaining > 0) {
    if (remaining === 1) {
      encoded += ch;
      remaining = 0;
      continue;
    }
    // One ACS prefix encodes at most 400 + 19 repeats; longer runs loop.
    const twenties = Math.min(Math.floor(remaining / 20), 20);
    const ones = Math.min(remaining - twenties * 20, 19);
    let prefix = '';
    if (twenties > 0) {
      prefix += String.fromCharCode(0x66 + twenties); // 'g' + n
    }
    if (ones > 0) {
      prefix += String.fromCharCode(0x46 + ones); // 'G' + n
    }
    encoded += prefix + ch;
    remaining -= twenties * 20 + ones;
  }
  return encoded;
}
