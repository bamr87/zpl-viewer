/**
 * Central resource limits for untrusted label input.
 *
 * Label files come from printer captures, other repositories and attachments,
 * and the parser runs in the extension host as well as the webview, so a field
 * that declares a huge bitmap, or a tiny `:Z64:` payload that inflates without
 * bound, must not be able to exhaust memory or hang the preview. Every cap
 * lives here so it can be tuned in one place. Pure layer: no `vscode`, `fs`,
 * `net` or `zlib`.
 */

/**
 * Largest graphic side in dots. An 8 inch print head at 600 dpi is 4,800 dots,
 * so this leaves headroom over real hardware (Labelary caps embedded images
 * far lower, at 2,000 px).
 */
export const MAX_GRAPHIC_DOTS = 8192;

/** Largest decoded bitmap for one graphic: `MAX_GRAPHIC_DOTS` squared at 1 bit per dot. */
export const MAX_GRAPHIC_BYTES = (MAX_GRAPHIC_DOTS * MAX_GRAPHIC_DOTS) / 8;

/** Decoded graphic bytes one label (`^XA` ... `^XZ`) may hold in `^GF` fields. */
export const MAX_LABEL_GRAPHIC_BYTES = 4 * MAX_GRAPHIC_BYTES;

/** Total decoded bytes the `~DG` / `~DY` graphic store may hold. */
export const MAX_STORE_BYTES = 4 * MAX_GRAPHIC_BYTES;

/** Widest bitmap row in bytes, derived from `MAX_GRAPHIC_DOTS`. */
export const MAX_GRAPHIC_BYTES_PER_ROW = MAX_GRAPHIC_DOTS / 8;

/** Most pixels a decoded PNG may have (its RGBA buffer is four bytes each). */
export const MAX_IMAGE_PIXELS = 25_000_000;

/** Thrown when an output cap is passed while decompressing. */
export class InflateLimitError extends Error {
  readonly limit: number;

  constructor(limit: number) {
    super(`Decompressed data is larger than the ${limit} byte limit.`);
    this.name = 'InflateLimitError';
    this.limit = limit;
  }
}

/**
 * Describes why a graphic of the declared geometry is over the limits, or
 * `undefined` when it is acceptable. `totalBytes` of 0 means "not declared".
 * `maxBytes` lets a caller pass what is left of a per-label or per-store budget.
 */
export function graphicLimitProblem(
  bytesPerRow: number,
  totalBytes: number,
  maxBytes: number = MAX_GRAPHIC_BYTES,
): string | undefined {
  if (bytesPerRow > MAX_GRAPHIC_BYTES_PER_ROW) {
    return `${bytesPerRow} bytes per row exceeds the limit of ${MAX_GRAPHIC_BYTES_PER_ROW} (${MAX_GRAPHIC_DOTS} dots).`;
  }
  const limit = Math.min(maxBytes, MAX_GRAPHIC_BYTES);
  if (totalBytes > limit) {
    return `${totalBytes} bytes exceeds the limit of ${limit}.`;
  }
  return undefined;
}
