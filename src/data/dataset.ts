/**
 * Unified dataset model. Anything that can supply label values — CSV/TSV
 * exports, JSON arrays, newline-delimited JSON — is normalized into a
 * {@link Dataset} of string values keyed by field name, which is what the
 * merge engine and the mapping UI consume.
 */

import { parseCsv } from './csv';

export type DatasetSourceKind = 'csv' | 'tsv' | 'json' | 'jsonl';

export type FieldType = 'string' | 'number' | 'boolean' | 'empty';

export interface DatasetField {
  name: string;
  type: FieldType;
  /** First non-empty value, for previews and placeholder hints. */
  sample: string;
  /** Number of rows where this field is empty or absent. */
  missing: number;
}

export interface Dataset {
  /** Display name, usually the file name. */
  name: string;
  kind: DatasetSourceKind;
  fields: DatasetField[];
  rows: Record<string, string>[];
  warnings: string[];
}

export interface LoadDatasetOptions {
  name?: string;
  /** Force a delimiter for delimited text. */
  delimiter?: string;
  /** Force the source kind instead of sniffing it. */
  kind?: DatasetSourceKind;
}

const NUMBER_RE = /^-?\d+(\.\d+)?$/;
const BOOLEAN_RE = /^(true|false|yes|no|y|n)$/i;

function extensionOf(fileName: string): string {
  const base = fileName.replace(/\\/g, '/').split('/').pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot < 0 ? '' : base.slice(dot + 1).toLowerCase();
}

export function detectDatasetKind(
  text: string,
  fileName?: string,
): DatasetSourceKind {
  const ext = fileName ? extensionOf(fileName) : '';
  if (ext === 'json') {
    return 'json';
  }
  if (ext === 'jsonl' || ext === 'ndjson') {
    return 'jsonl';
  }
  if (ext === 'tsv') {
    return 'tsv';
  }
  if (ext === 'csv' || ext === 'psv') {
    return 'csv';
  }
  const trimmed = text.trimStart();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    const lines = trimmed.split(/\r?\n/).filter((l) => l.trim().length > 0);
    const everyLineIsObject =
      lines.length > 1 && lines.every((l) => l.trim().startsWith('{'));
    return everyLineIsObject ? 'jsonl' : 'json';
  }
  return 'csv';
}

function inferType(values: string[]): FieldType {
  const nonEmpty = values.filter((v) => v !== '');
  if (nonEmpty.length === 0) {
    return 'empty';
  }
  if (nonEmpty.every((v) => NUMBER_RE.test(v))) {
    return 'number';
  }
  if (nonEmpty.every((v) => BOOLEAN_RE.test(v))) {
    return 'boolean';
  }
  return 'string';
}

function describeFields(
  names: string[],
  rows: Record<string, string>[],
): DatasetField[] {
  return names.map((name) => {
    const values = rows.map((row) => row[name] ?? '');
    return {
      name,
      type: inferType(values),
      sample: values.find((v) => v !== '') ?? '',
      missing: values.filter((v) => v === '').length,
    };
  });
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}

/** Flattens nested objects into dotted keys so `{{address.city}}` resolves. */
function flattenRecord(
  value: Record<string, unknown>,
  prefix = '',
  out: Record<string, string> = {},
): Record<string, string> {
  for (const [key, raw] of Object.entries(value)) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      flattenRecord(raw as Record<string, unknown>, name, out);
    } else {
      out[name] = stringifyValue(raw);
    }
  }
  return out;
}

function recordsFromJson(
  parsed: unknown,
  warnings: string[],
): Record<string, string>[] {
  if (Array.isArray(parsed)) {
    return parsed.map((entry) =>
      entry && typeof entry === 'object'
        ? flattenRecord(entry as Record<string, unknown>)
        : { value: stringifyValue(entry) },
    );
  }
  if (parsed && typeof parsed === 'object') {
    // Accept the common `{ "rows": [...] }` / `{ "data": [...] }` envelopes.
    for (const key of ['rows', 'data', 'records', 'items']) {
      const inner = (parsed as Record<string, unknown>)[key];
      if (Array.isArray(inner)) {
        return recordsFromJson(inner, warnings);
      }
    }
    warnings.push('JSON object treated as a single row.');
    return [flattenRecord(parsed as Record<string, unknown>)];
  }
  warnings.push('JSON value is not an object or array; no rows were loaded.');
  return [];
}

export function loadDataset(
  text: string,
  fileName?: string,
  options: LoadDatasetOptions = {},
): Dataset {
  const kind = options.kind ?? detectDatasetKind(text, fileName);
  const name =
    options.name ?? (fileName ? (fileName.replace(/\\/g, '/').split('/').pop() ?? 'dataset') : 'dataset');
  const warnings: string[] = [];
  let rows: Record<string, string>[] = [];
  let names: string[] = [];

  if (kind === 'json' || kind === 'jsonl') {
    if (kind === 'jsonl') {
      const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
      rows = [];
      lines.forEach((line, index) => {
        try {
          const parsed: unknown = JSON.parse(line);
          rows.push(
            parsed && typeof parsed === 'object'
              ? flattenRecord(parsed as Record<string, unknown>)
              : { value: stringifyValue(parsed) },
          );
        } catch (err) {
          warnings.push(
            `Line ${index + 1} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      });
    } else {
      try {
        rows = recordsFromJson(JSON.parse(text) as unknown, warnings);
      } catch (err) {
        warnings.push(
          `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    const seen = new Set<string>();
    for (const row of rows) {
      for (const key of Object.keys(row)) {
        seen.add(key);
      }
    }
    names = [...seen];
    // Normalize so every row exposes every field.
    rows = rows.map((row) => {
      const full: Record<string, string> = {};
      for (const key of names) {
        full[key] = row[key] ?? '';
      }
      return full;
    });
  } else {
    const table = parseCsv(text, {
      delimiter: options.delimiter ?? (kind === 'tsv' ? '\t' : undefined),
    });
    warnings.push(...table.warnings);
    names = table.header;
    rows = table.rows.map((values) => {
      const row: Record<string, string> = {};
      names.forEach((field, index) => {
        row[field] = values[index] ?? '';
      });
      return row;
    });
  }

  return {
    name,
    kind,
    fields: describeFields(names, rows),
    rows,
    warnings,
  };
}

/** Looks a field up leniently: exact, then case-insensitive, then normalized. */
export function resolveField(
  row: Record<string, string>,
  name: string,
): string | undefined {
  if (Object.prototype.hasOwnProperty.call(row, name)) {
    return row[name];
  }
  const wanted = name.toLowerCase();
  for (const key of Object.keys(row)) {
    if (key.toLowerCase() === wanted) {
      return row[key];
    }
  }
  const normalize = (value: string): string =>
    value.toLowerCase().replace(/[^a-z0-9]/g, '');
  const normalized = normalize(name);
  for (const key of Object.keys(row)) {
    if (normalize(key) === normalized) {
      return row[key];
    }
  }
  return undefined;
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/** Markdown preview of a dataset, used by the data-source preview command. */
export function datasetToMarkdown(dataset: Dataset, maxRows = 25): string {
  const lines: string[] = [
    `# Data source: ${dataset.name}`,
    '',
    `- Format: \`${dataset.kind}\``,
    `- Rows: ${dataset.rows.length}`,
    `- Fields: ${dataset.fields.length}`,
    '',
  ];

  if (dataset.warnings.length > 0) {
    lines.push('## Warnings', '');
    for (const warning of dataset.warnings) {
      lines.push(`- ${warning}`);
    }
    lines.push('');
  }

  lines.push('## Fields', '', '| Field | Type | Empty rows | Sample |', '|---|---|---|---|');
  for (const field of dataset.fields) {
    lines.push(
      `| \`${field.name}\` | ${field.type} | ${field.missing} | ${escapeCell(field.sample) || '—'} |`,
    );
  }
  lines.push('');

  if (dataset.rows.length > 0) {
    const shown = dataset.rows.slice(0, maxRows);
    const names = dataset.fields.map((f) => f.name);
    lines.push(
      `## Rows (${shown.length} of ${dataset.rows.length})`,
      '',
      `| ${names.join(' | ')} |`,
      `|${names.map(() => '---').join('|')}|`,
    );
    for (const row of shown) {
      lines.push(`| ${names.map((n) => escapeCell(row[n] ?? '')).join(' | ')} |`);
    }
    lines.push('');
  }

  lines.push(
    '## Use it',
    '',
    'Reference any field from a label template with `{{field}}`, then run',
    '**Label: Merge Data Into Labels** to expand the template over every row.',
    '',
  );
  return lines.join('\n');
}
