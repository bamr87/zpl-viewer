/**
 * Dependency-free base64, because the pure layer has neither `Buffer` nor a
 * guaranteed `atob`: it is compiled into the webview bundle, exercised by
 * Node unit tests, and must behave identically in both.
 *
 * ZPL carries graphics as `:B64:`/`:Z64:` payloads, so decoding has to tolerate
 * the whitespace and line breaks that printer captures pick up in transit.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const DECODE_TABLE = (() => {
  const table = new Int16Array(256).fill(-1);
  for (let i = 0; i < ALPHABET.length; i += 1) {
    table[ALPHABET.charCodeAt(i)] = i;
  }
  return table;
})();

/**
 * Decodes base64 text to bytes. Whitespace is ignored, padding is optional,
 * and any character outside the alphabet ends the decode rather than throwing —
 * a truncated graphic still renders as far as it goes.
 */
export function base64Decode(text: string): Uint8Array {
  const out: number[] = [];
  let accumulator = 0;
  let bits = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code === 0x3d) {
      break; // '=' padding
    }
    const value = code < 256 ? DECODE_TABLE[code] : -1;
    if (value < 0) {
      continue;
    }
    accumulator = (accumulator << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((accumulator >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

/** Encodes bytes as padded base64. */
export function base64Encode(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += ALPHABET[b0 >> 2];
    out += ALPHABET[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
    out += b1 === undefined ? '=' : ALPHABET[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)];
    out += b2 === undefined ? '=' : ALPHABET[b2 & 0x3f];
  }
  return out;
}
