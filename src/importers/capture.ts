/**
 * Import of raw printer captures.
 *
 * Spool files, port sniffs and `.prn` dumps from a working system are the best
 * documentation of a label that exists — but they arrive as one long line with
 * control characters, driver preambles and dozens of labels concatenated
 * together. This turns such a capture into a readable, editable document.
 */

import { LabelFormatId, detectFormat } from '../core/formats';
import { formatLabel } from '../core/pipeline';

export interface CaptureImportOptions {
  format?: LabelFormatId;
  /** Run the language formatter over each label (default true). */
  reformat?: boolean;
}

export interface CaptureImportResult {
  format: LabelFormatId;
  /** Individual label sources, in stream order. */
  labels: string[];
  /** Cleaned document containing every label. */
  text: string;
  /** Control characters removed from the stream. */
  strippedControlCharacters: number;
  warnings: string[];
}

/** Characters a printer treats as flow control or padding, never as content. */
const CONTROL_CHARACTERS =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function splitZplLabels(text: string): string[] {
  const labels: string[] = [];
  const pattern = /\^XA[\s\S]*?\^XZ/g;
  let match = pattern.exec(text);
  while (match) {
    labels.push(match[0]);
    match = pattern.exec(text);
  }
  return labels;
}

function splitEplLabels(text: string): string[] {
  const labels: string[] = [];
  let current: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    current.push(trimmed);
    if (/^P\d*(,\d+)?$/.test(trimmed)) {
      labels.push(current.join('\n'));
      current = [];
    }
  }
  if (current.length > 0) {
    labels.push(current.join('\n'));
  }
  return labels;
}

export function importCapture(
  raw: string,
  options: CaptureImportOptions = {},
): CaptureImportResult {
  const warnings: string[] = [];
  const stripped = raw.match(CONTROL_CHARACTERS)?.length ?? 0;
  const cleaned = raw.replace(CONTROL_CHARACTERS, '').replace(/\r\n?/g, '\n');
  const format = options.format ?? detectFormat(cleaned);

  let labels =
    format === 'epl' ? splitEplLabels(cleaned) : splitZplLabels(cleaned);

  if (labels.length === 0) {
    warnings.push(
      format === 'zpl'
        ? 'No complete `^XA … ^XZ` label found; the capture was imported as-is.'
        : 'No `P` (print) command found; the capture was imported as-is.',
    );
    labels = [cleaned.trim()];
  }

  if (options.reformat !== false) {
    labels = labels.map((label) => formatLabel(label, format).trimEnd());
  }

  if (stripped > 0) {
    warnings.push(`Removed ${stripped} control character(s) from the capture.`);
  }

  return {
    format,
    labels,
    text: labels.join('\n\n') + '\n',
    strippedControlCharacters: stripped,
    warnings,
  };
}
