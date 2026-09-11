/**
 * Dependency-free delimited-text reader/writer (RFC 4180 with the usual
 * real-world tolerances: BOM, CRLF or LF, ragged rows, `""` escapes).
 *
 * Label data arrives as a WMS export, an ERP dump or a spreadsheet save far
 * more often than as clean JSON, so this is the front door of the data
 * integration pipeline.
 */

export interface CsvParseOptions {
  /** Field separator. Sniffed from the header line when omitted. */
  delimiter?: string;
  /** Treat the first non-empty row as a header (default true). */
  hasHeader?: boolean;
  /** Trim surrounding whitespace on unquoted values (default true). */
  trim?: boolean;
}

export interface CsvTable {
  header: string[];
  rows: string[][];
  delimiter: string;
  warnings: string[];
}

const CANDIDATE_DELIMITERS = [',', ';', '\t', '|'];

/** Picks the delimiter that yields the most consistent column count. */
export function sniffDelimiter(text: string): string {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .slice(0, 20);
  if (lines.length === 0) {
    return ',';
  }
  let best = ',';
  let bestScore = -1;
  for (const delimiter of CANDIDATE_DELIMITERS) {
    const counts = lines.map(
      (line) => splitLineNaive(line, delimiter).length,
    );
    const first = counts[0];
    if (first < 2) {
      continue;
    }
    const consistent = counts.filter((c) => c === first).length;
    const score = first * 10 + consistent;
    if (score > bestScore) {
      bestScore = score;
      best = delimiter;
    }
  }
  return best;
}

/** Quote-unaware split used only for delimiter sniffing. */
function splitLineNaive(line: string, delimiter: string): string[] {
  return line.split(delimiter);
}

export function parseCsv(
  text: string,
  options: CsvParseOptions = {},
): CsvTable {
  const source = text.replace(/^\uFEFF/, '');
  const delimiter = options.delimiter ?? sniffDelimiter(source);
  const hasHeader = options.hasHeader ?? true;
  const trim = options.trim ?? true;
  const warnings: string[] = [];

  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;
  let fieldWasQuoted = false;

  const pushField = (): void => {
    record.push(trim && !fieldWasQuoted ? field.trim() : field);
    field = '';
    fieldWasQuoted = false;
  };
  const pushRecord = (): void => {
    pushField();
    // Skip records that are entirely empty (trailing newline, blank lines).
    if (record.length > 1 || record[0] !== '') {
      records.push(record);
    }
    record = [];
  };

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (inQuotes) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field.trim() === '') {
      inQuotes = true;
      fieldWasQuoted = true;
      field = '';
      continue;
    }
    if (ch === delimiter) {
      pushField();
      continue;
    }
    if (ch === '\r') {
      continue;
    }
    if (ch === '\n') {
      pushRecord();
      continue;
    }
    field += ch;
  }
  if (field.length > 0 || record.length > 0) {
    pushRecord();
  }
  if (inQuotes) {
    warnings.push('Unterminated quoted field; the last value may be truncated.');
  }

  if (records.length === 0) {
    return { header: [], rows: [], delimiter, warnings };
  }

  const header = hasHeader
    ? records[0].map((name, index) => name || `column${index + 1}`)
    : records[0].map((_, index) => `column${index + 1}`);
  const body = hasHeader ? records.slice(1) : records;

  const ragged = body.filter((row) => row.length !== header.length).length;
  if (ragged > 0) {
    warnings.push(
      `${ragged} row(s) do not have ${header.length} columns; missing values were padded.`,
    );
  }

  return {
    header,
    rows: body.map((row) => {
      if (row.length === header.length) {
        return row;
      }
      const padded = row.slice(0, header.length);
      while (padded.length < header.length) {
        padded.push('');
      }
      return padded;
    }),
    delimiter,
    warnings,
  };
}

function quoteValue(value: string, delimiter: string): string {
  if (
    value.includes(delimiter) ||
    value.includes('"') ||
    value.includes('\n') ||
    value.includes('\r')
  ) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function toCsv(
  header: string[],
  rows: string[][],
  delimiter = ',',
): string {
  const lines = [header.map((h) => quoteValue(h, delimiter)).join(delimiter)];
  for (const row of rows) {
    lines.push(row.map((value) => quoteValue(value, delimiter)).join(delimiter));
  }
  return lines.join('\n') + '\n';
}
