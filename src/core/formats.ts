/**
 * Registry of the label description languages this extension understands.
 *
 * Everything downstream — parsing, validation, formatting, emitting, deploying
 * — is keyed on a {@link LabelFormatId}, so adding a printer language means
 * registering it here and implementing the matching modules under
 * `src/formats/<id>/`.
 */

export type LabelFormatId = 'zpl' | 'epl';

export interface LabelFormat {
  id: LabelFormatId;
  /** Display name, e.g. "ZPL II". */
  label: string;
  /** VS Code language id contributed for this format. */
  languageId: string;
  /** File extensions that unambiguously belong to this format. */
  extensions: string[];
  /** Extensions shared with other formats; content sniffing decides. */
  ambiguousExtensions: string[];
  description: string;
  /** Vendors/printer families that speak this language. */
  vendors: string[];
}

export const LABEL_FORMATS: Record<LabelFormatId, LabelFormat> = {
  zpl: {
    id: 'zpl',
    label: 'ZPL II',
    languageId: 'zpl',
    extensions: ['.zpl', '.zpl2'],
    ambiguousExtensions: ['.prn', '.lbl', '.txt'],
    description: 'Zebra Programming Language II — caret/tilde command stream.',
    vendors: ['Zebra', 'Honeywell (ZSim)', 'TSC (ZPL emulation)'],
  },
  epl: {
    id: 'epl',
    label: 'EPL2',
    languageId: 'epl',
    extensions: ['.epl', '.epl2'],
    ambiguousExtensions: ['.prn', '.lbl', '.txt'],
    description: 'Eltron Programming Language 2 — line-oriented command set.',
    vendors: ['Zebra (LP/TLP series)', 'Eltron', 'TSC (EPL emulation)'],
  },
};

export const ALL_FORMAT_IDS: LabelFormatId[] = Object.keys(
  LABEL_FORMATS,
) as LabelFormatId[];

export function isLabelFormatId(value: string): value is LabelFormatId {
  return Object.prototype.hasOwnProperty.call(LABEL_FORMATS, value);
}

/** Every extension any format claims, ambiguous ones included. */
export function labelFileExtensions(): string[] {
  const out = new Set<string>();
  for (const format of Object.values(LABEL_FORMATS)) {
    format.extensions.forEach((e) => out.add(e));
    format.ambiguousExtensions.forEach((e) => out.add(e));
  }
  return [...out].sort();
}

function extensionOf(fileName: string): string {
  const normalized = fileName.replace(/\\/g, '/');
  const base = normalized.slice(normalized.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot < 0 ? '' : base.slice(dot).toLowerCase();
}

/** Format claimed unambiguously by a file extension, if any. */
export function formatForFileName(
  fileName: string,
): LabelFormatId | undefined {
  const ext = extensionOf(fileName);
  if (!ext) {
    return undefined;
  }
  for (const format of Object.values(LABEL_FORMATS)) {
    if (format.extensions.includes(ext)) {
      return format.id;
    }
  }
  return undefined;
}

/**
 * Guesses the format from the content itself. ZPL is recognized by its
 * `^XA`/`^XZ` envelope (or any caret/tilde command); EPL by its line-oriented
 * verbs — `N`, `q`, `Q`, `A…"text"`, `B…"data"`, `P1`.
 */
export function sniffFormat(source: string): LabelFormatId | undefined {
  const sample = source.slice(0, 8192);
  if (/\^XA|\^XZ|~[A-Z]{2}/i.test(sample)) {
    return 'zpl';
  }
  const eplHits = sample
    .split(/\r?\n/)
    .filter((line) =>
      /^\s*(N|R\d|ZB|ZT|OD|JF|JB|S[0-5]|D\d{1,2}|q\d+|Q\d+,\d+|[ABX]\d+,\d+|LO\d+,\d+|LE\d+,\d+|GW\d+,\d+|P\d*)\s*$|^\s*[ABbX]\d+,\d+,.*$/.test(
        line,
      ),
    ).length;
  if (eplHits >= 2) {
    return 'epl';
  }
  if (/\^[A-Z]{2}/i.test(sample)) {
    return 'zpl';
  }
  return undefined;
}

/**
 * Best-effort format detection: an unambiguous extension wins, then content
 * sniffing, then the supplied fallback (ZPL by default — it is the lingua
 * franca of thermal labels).
 */
export function detectFormat(
  source: string,
  fileName?: string,
  fallback: LabelFormatId = 'zpl',
): LabelFormatId {
  if (fileName) {
    const byName = formatForFileName(fileName);
    if (byName) {
      return byName;
    }
  }
  return sniffFormat(source) ?? fallback;
}
