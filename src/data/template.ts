/**
 * Label templating: `{{field}}` placeholders with an optional filter pipeline,
 * plus the per-format escaping that keeps merged data from being mistaken for
 * printer commands.
 *
 * `{{sku|upper|left:10}}` → the `sku` column, upper-cased, first ten characters.
 */

import { LabelFormatId } from '../core/formats';
import { resolveField } from './dataset';

export interface TemplateFilter {
  name: string;
  arg?: string;
}

export interface Placeholder {
  /** Full match including the braces. */
  raw: string;
  field: string;
  filters: TemplateFilter[];
  start: number;
  end: number;
}

export interface RenderTemplateOptions {
  /** Escape substituted values for this printer language (default none). */
  format?: LabelFormatId;
  /** What to do when the row has no such field (default `empty`). */
  onMissing?: 'empty' | 'keep';
}

export interface RenderTemplateResult {
  text: string;
  /** Placeholder names the row had no value for. */
  missing: string[];
  /** Offsets in `text` where an escape sequence was written. */
  escapeOffsets: number[];
}

const PLACEHOLDER_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;

export function findPlaceholders(text: string): Placeholder[] {
  const out: Placeholder[] = [];
  PLACEHOLDER_RE.lastIndex = 0;
  let match = PLACEHOLDER_RE.exec(text);
  while (match) {
    const parts = match[1].split('|').map((p) => p.trim());
    const field = parts.shift() ?? '';
    out.push({
      raw: match[0],
      field,
      filters: parts.filter(Boolean).map((part) => {
        const colon = part.indexOf(':');
        return colon < 0
          ? { name: part.toLowerCase() }
          : {
              name: part.slice(0, colon).trim().toLowerCase(),
              arg: part.slice(colon + 1).trim(),
            };
      }),
      start: match.index,
      end: match.index + match[0].length,
    });
    match = PLACEHOLDER_RE.exec(text);
  }
  return out;
}

/** Distinct field names referenced by a template, in first-seen order. */
export function templateFields(text: string): string[] {
  const seen = new Set<string>();
  for (const placeholder of findPlaceholders(text)) {
    seen.add(placeholder.field);
  }
  return [...seen];
}

export function applyFilters(
  value: string,
  filters: TemplateFilter[],
): string {
  let out = value;
  for (const filter of filters) {
    const size = filter.arg === undefined ? NaN : parseInt(filter.arg, 10);
    switch (filter.name) {
      case 'upper':
        out = out.toUpperCase();
        break;
      case 'lower':
        out = out.toLowerCase();
        break;
      case 'trim':
        out = out.trim();
        break;
      case 'title':
        out = out.replace(/\w\S*/g, (word) =>
          word[0].toUpperCase() + word.slice(1).toLowerCase(),
        );
        break;
      case 'digits':
        out = out.replace(/\D/g, '');
        break;
      case 'alnum':
        out = out.replace(/[^A-Za-z0-9]/g, '');
        break;
      case 'left':
        out = Number.isFinite(size) ? out.slice(0, size) : out;
        break;
      case 'right':
        out = Number.isFinite(size) ? out.slice(-size) : out;
        break;
      case 'pad':
      case 'padleft':
        out = Number.isFinite(size) ? out.padStart(size, '0') : out;
        break;
      case 'padright':
        out = Number.isFinite(size) ? out.padEnd(size, ' ') : out;
        break;
      case 'default':
        out = out === '' ? (filter.arg ?? '') : out;
        break;
      default:
        // Unknown filters pass the value through unchanged; the mapping report
        // surfaces them so a typo is visible without breaking the merge.
        break;
    }
  }
  return out;
}

export const KNOWN_FILTERS = [
  'upper',
  'lower',
  'trim',
  'title',
  'digits',
  'alnum',
  'left',
  'right',
  'pad',
  'padleft',
  'padright',
  'default',
] as const;

/**
 * ZPL treats `^` and `~` as command introducers anywhere in the stream, so
 * merged data containing them is rewritten as `_xx` hex escapes. The field
 * needs a `^FH` prefix for the printer to decode those — {@link ensureHexEscapePrefixes}
 * adds it to exactly the fields that got one.
 */
export function escapeZplData(value: string): {
  value: string;
  escaped: boolean;
} {
  let escaped = false;
  const out = value.replace(/[\^~_\r\n]/g, (ch) => {
    escaped = true;
    switch (ch) {
      case '\r':
        return '_0D';
      case '\n':
        return '_0A';
      default:
        return `_${ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`;
    }
  });
  return { value: out, escaped };
}

/** EPL2 carries data inside double quotes; only quotes and newlines can break out. */
export function escapeEplData(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, ' ');
}

/**
 * Inserts `^FH` in front of every `^FD` whose data contains an escape this
 * merge introduced, leaving hand-written fields untouched.
 */
export function ensureHexEscapePrefixes(
  text: string,
  escapeOffsets: number[],
): string {
  if (escapeOffsets.length === 0) {
    return text;
  }
  const insertAt = new Set<number>();
  for (const offset of escapeOffsets) {
    const fdIndex = text.lastIndexOf('^FD', offset);
    if (fdIndex < 0) {
      continue;
    }
    // Only fields, not data that merely follows a terminated field.
    const fsIndex = text.lastIndexOf('^FS', offset);
    if (fsIndex > fdIndex) {
      continue;
    }
    const fieldStart = Math.max(
      text.lastIndexOf('^FS', fdIndex),
      text.lastIndexOf('^XA', fdIndex),
    );
    const prelude = text.slice(Math.max(0, fieldStart), fdIndex);
    if (prelude.includes('^FH')) {
      continue;
    }
    insertAt.add(fdIndex);
  }
  let out = text;
  for (const offset of [...insertAt].sort((a, b) => b - a)) {
    out = out.slice(0, offset) + '^FH' + out.slice(offset);
  }
  return out;
}

/** Substitutes one row of data into a template. */
export function renderTemplate(
  template: string,
  row: Record<string, string>,
  options: RenderTemplateOptions = {},
): RenderTemplateResult {
  const missing: string[] = [];
  const escapeOffsets: number[] = [];
  const placeholders = findPlaceholders(template);
  if (placeholders.length === 0) {
    return { text: template, missing, escapeOffsets };
  }

  let out = '';
  let cursor = 0;
  for (const placeholder of placeholders) {
    out += template.slice(cursor, placeholder.start);
    cursor = placeholder.end;

    const resolved = resolveField(row, placeholder.field);
    if (resolved === undefined) {
      missing.push(placeholder.field);
      if (options.onMissing === 'keep') {
        out += placeholder.raw;
        continue;
      }
    }
    const filtered = applyFilters(resolved ?? '', placeholder.filters);
    if (options.format === 'zpl') {
      const { value, escaped } = escapeZplData(filtered);
      if (escaped) {
        escapeOffsets.push(out.length);
      }
      out += value;
    } else if (options.format === 'epl') {
      out += escapeEplData(filtered);
    } else {
      out += filtered;
    }
  }
  out += template.slice(cursor);

  if (options.format === 'zpl') {
    out = ensureHexEscapePrefixes(out, escapeOffsets);
  }
  return { text: out, missing, escapeOffsets };
}
