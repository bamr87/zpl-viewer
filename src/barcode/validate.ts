/**
 * Barcode payload validation and check-digit arithmetic.
 *
 * Printers silently emit an unscannable symbol when the payload breaks the
 * symbology's rules, so catching it in the editor is the whole point: every
 * rule here maps to a way a real label fails on the line.
 */

import {
  CheckDigitScheme,
  SymbologySpec,
  findSymbology,
} from './symbologies';

export type BarcodeIssueSeverity = 'error' | 'warning' | 'info';

export interface BarcodeIssue {
  severity: BarcodeIssueSeverity;
  /** Stable identifier so callers can filter or suppress a rule. */
  code:
    | 'unknown-symbology'
    | 'empty-data'
    | 'charset'
    | 'length'
    | 'check-digit'
    | 'odd-length'
    | 'capacity'
    | 'gs1-syntax';
  message: string;
}

const CODE39_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%';

/** UPC/EAN/ITF modulo 10: weights alternate 3,1 from the right of the payload. */
export function mod10CheckDigit(payload: string): string {
  let sum = 0;
  for (let i = payload.length - 1, weight = 3; i >= 0; i -= 1, weight = 4 - weight) {
    sum += Number(payload[i]) * weight;
  }
  return String((10 - (sum % 10)) % 10);
}

/** POSTNET/PLANET modulo 10: plain digit sum. */
export function mod10FlatCheckDigit(payload: string): string {
  let sum = 0;
  for (const ch of payload) {
    sum += Number(ch);
  }
  return String((10 - (sum % 10)) % 10);
}

/** Code 39 / LOGMARS modulo 43 over the symbology alphabet. */
export function mod43CheckCharacter(payload: string): string {
  let sum = 0;
  for (const ch of payload.toUpperCase()) {
    const value = CODE39_ALPHABET.indexOf(ch);
    if (value < 0) {
      return '';
    }
    sum += value;
  }
  return CODE39_ALPHABET[sum % 43];
}

export function computeCheckDigit(
  scheme: CheckDigitScheme,
  payload: string,
): string | undefined {
  switch (scheme) {
    case 'mod10':
      return /^[0-9]+$/.test(payload) ? mod10CheckDigit(payload) : undefined;
    case 'mod10-flat':
      return /^[0-9]+$/.test(payload) ? mod10FlatCheckDigit(payload) : undefined;
    case 'mod43':
      return mod43CheckCharacter(payload) || undefined;
    default:
      return undefined;
  }
}

function offendingCharacters(data: string, charset: RegExp): string[] {
  const bad = new Set<string>();
  for (const ch of data) {
    if (!charset.test(ch)) {
      bad.add(ch);
    }
  }
  return [...bad];
}

function checkFixedLength(
  spec: SymbologySpec,
  data: string,
  issues: BarcodeIssue[],
): void {
  const lengths = spec.fixedLengths;
  if (!lengths || lengths.length === 0) {
    return;
  }
  if (!lengths.includes(data.length)) {
    issues.push({
      severity: 'error',
      code: 'length',
      message: `${spec.label} needs ${lengths.join(' or ')} characters, got ${data.length}.`,
    });
    return;
  }
  const longest = Math.max(...lengths);
  if (data.length !== longest) {
    const expected = computeCheckDigit(spec.checkDigit, data);
    if (expected) {
      issues.push({
        severity: 'info',
        code: 'check-digit',
        message: `Printer will append check digit ${expected} (full code ${data}${expected}).`,
      });
    }
    return;
  }
  const payload = data.slice(0, -1);
  const expected = computeCheckDigit(spec.checkDigit, payload);
  if (expected && expected !== data.slice(-1)) {
    issues.push({
      severity: 'error',
      code: 'check-digit',
      message: `Check digit ${data.slice(-1)} is wrong for ${payload}; expected ${expected}.`,
    });
  }
}

/**
 * Validates a payload against a symbology. Returns an empty array when the
 * data will encode cleanly.
 */
export function validateBarcodeData(
  symbology: string | undefined,
  data: string,
): BarcodeIssue[] {
  const spec = findSymbology(symbology);
  if (!spec) {
    return [
      {
        severity: 'warning',
        code: 'unknown-symbology',
        message: `Unknown barcode symbology \`${symbology ?? '(none)'}\`; data was not validated.`,
      },
    ];
  }

  const issues: BarcodeIssue[] = [];
  if (data.length === 0) {
    issues.push({
      severity: 'error',
      code: 'empty-data',
      message: `${spec.label} field has no data.`,
    });
    return issues;
  }

  if (!spec.charset.test(data)) {
    // Codabar folds its start/stop guards into the payload, so a per-character
    // test says nothing useful — report the structure instead.
    const bad = spec.id === 'codabar' ? [] : offendingCharacters(data, spec.charset);
    issues.push({
      severity: 'error',
      code: 'charset',
      message:
        bad.length > 0
          ? `${spec.label} cannot encode ${bad.map((c) => JSON.stringify(c)).join(', ')}. Allowed: ${spec.charsetLabel}.`
          : `${spec.label} data does not match the required pattern. Allowed: ${spec.charsetLabel}.`,
    });
  }

  checkFixedLength(spec, data, issues);

  if (!spec.fixedLengths) {
    if (spec.minLength && data.length < spec.minLength) {
      issues.push({
        severity: 'error',
        code: 'length',
        message: `${spec.label} needs at least ${spec.minLength} characters, got ${data.length}.`,
      });
    }
    if (spec.maxLength && data.length > spec.maxLength) {
      issues.push({
        severity: 'error',
        code: 'capacity',
        message: `${spec.label} holds at most ${spec.maxLength} characters, got ${data.length}.`,
      });
    }
  }

  if (spec.requiresEvenLength && data.length % 2 !== 0) {
    issues.push({
      severity: 'warning',
      code: 'odd-length',
      message: `${spec.label} encodes digit pairs; an odd payload is padded with a leading zero by the printer.`,
    });
  }

  if (spec.gs1 && data.includes('(')) {
    const opens = (data.match(/\(/g) ?? []).length;
    const closes = (data.match(/\)/g) ?? []).length;
    if (opens !== closes) {
      issues.push({
        severity: 'error',
        code: 'gs1-syntax',
        message: 'Unbalanced parentheses in GS1 application identifiers.',
      });
    }
  }

  return issues;
}

/**
 * Returns the payload a printer would actually encode: appends the check digit
 * when the symbology expects one and the caller supplied the short form.
 */
export function completeBarcodeData(
  symbology: string | undefined,
  data: string,
): string {
  const spec = findSymbology(symbology);
  if (!spec || !spec.fixedLengths || data.length === 0) {
    return data;
  }
  const longest = Math.max(...spec.fixedLengths);
  if (data.length >= longest) {
    return data;
  }
  if (!spec.fixedLengths.includes(data.length)) {
    return data;
  }
  const check = computeCheckDigit(spec.checkDigit, data);
  return check ? data + check : data;
}

export function hasBlockingIssue(issues: BarcodeIssue[]): boolean {
  return issues.some((issue) => issue.severity === 'error');
}
