/**
 * Catalog of every barcode symbology the extension can render, validate, emit
 * and deploy. This is the single source of truth shared by the renderer
 * (bwip-js ids), the format emitters (ZPL/EPL command codes), the validator
 * (charset + length + check-digit rules) and the barcode studio UI.
 *
 * Pure and isomorphic: the webview bundle imports it directly.
 */

import { BarcodeSymbology } from '../renderer/ir';

export type BarcodeKind = 'linear' | '2d' | 'postal';

export type CheckDigitScheme =
  | 'none'
  /** UPC/EAN/ITF style 3-1 weighted modulo 10. */
  | 'mod10'
  /** Flat digit-sum modulo 10 (postal codes). */
  | 'mod10-flat'
  /** Code 39 / LOGMARS modulo 43 over the symbology alphabet. */
  | 'mod43'
  /** Computed by the encoder itself; nothing to validate up front. */
  | 'internal';

export interface SymbologySpec {
  id: BarcodeSymbology;
  label: string;
  kind: BarcodeKind;
  /** bwip-js encoder id. */
  bwipId: string;
  /** Primary ZPL command, including the caret. */
  zplCommand?: string;
  /** Additional ZPL commands that resolve to this symbology. */
  zplAliases?: string[];
  /** EPL2 `B` command barcode selector. */
  eplCode?: string;
  /** EPL2 `b` (2-D) command type selector. */
  epl2dCode?: string;
  /** Whole-string charset test. */
  charset: RegExp;
  charsetLabel: string;
  /**
   * Accepted input lengths. When the longest entry is supplied, the trailing
   * character is treated as a check digit and verified; shorter accepted
   * lengths mean the encoder computes the check digit.
   */
  fixedLengths?: number[];
  minLength?: number;
  maxLength?: number;
  /** Payload must have an even number of characters (interleaved codes). */
  requiresEvenLength?: boolean;
  checkDigit: CheckDigitScheme;
  /** Carries GS1 application identifiers. */
  gs1?: boolean;
  example: string;
  description: string;
}

const DIGITS = /^[0-9]+$/;
const CODE39_CHARS = /^[0-9A-Z\-. $/+%]*$/;
const CODABAR_CHARS = /^[A-Da-d][0-9\-$:/.+]*[A-Da-d]$/;
const ASCII = /^[\u0000-\u007F]*$/;
const ANY = /^[\s\S]*$/;

export const SYMBOLOGIES: SymbologySpec[] = [
  {
    id: 'code128',
    label: 'Code 128',
    kind: 'linear',
    bwipId: 'code128',
    zplCommand: '^BC',
    eplCode: '3',
    charset: ASCII,
    charsetLabel: 'Any ASCII character (subsets A/B/C selected automatically)',
    minLength: 1,
    checkDigit: 'internal',
    example: 'ABC-123456',
    description:
      'Dense, variable-length linear code. The default choice for most logistics and retail applications.',
  },
  {
    id: 'gs1-128',
    label: 'GS1-128 (UCC/EAN-128)',
    kind: 'linear',
    bwipId: 'gs1-128',
    eplCode: '2',
    charset: ASCII,
    charsetLabel: 'ASCII with GS1 application identifiers in parentheses',
    minLength: 1,
    checkDigit: 'internal',
    gs1: true,
    example: '(01)09501101020917(10)LOT123',
    description:
      'Code 128 constrained to GS1 application identifiers - the shipping-container standard (SSCC-18, GTIN, lot, expiry).',
  },
  {
    id: 'code39',
    label: 'Code 39',
    kind: 'linear',
    bwipId: 'code39',
    zplCommand: '^B3',
    zplAliases: ['^BL'],
    eplCode: '0',
    charset: CODE39_CHARS,
    charsetLabel: '0-9, A-Z, space and - . $ / + %',
    minLength: 1,
    checkDigit: 'mod43',
    example: 'ASSET-0042',
    description:
      'Self-checking alphanumeric code used heavily in automotive, defence (LOGMARS) and asset tagging.',
  },
  {
    id: 'code93',
    label: 'Code 93',
    kind: 'linear',
    bwipId: 'code93',
    zplCommand: '^BA',
    eplCode: '1',
    charset: CODE39_CHARS,
    charsetLabel: '0-9, A-Z, space and - . $ / + %',
    minLength: 1,
    checkDigit: 'internal',
    example: 'CODE93',
    description:
      'Higher-density successor to Code 39 with two mandatory check characters.',
  },
  {
    id: 'code11',
    label: 'Code 11',
    kind: 'linear',
    bwipId: 'code11',
    zplCommand: '^B1',
    charset: /^[0-9-]+$/,
    charsetLabel: 'Digits and hyphen',
    minLength: 1,
    checkDigit: 'internal',
    example: '9988776655',
    description: 'Telecommunications equipment labelling (a.k.a. USD-8).',
  },
  {
    id: 'codabar',
    label: 'Codabar',
    kind: 'linear',
    bwipId: 'rationalizedCodabar',
    zplCommand: '^BK',
    eplCode: 'K',
    charset: CODABAR_CHARS,
    charsetLabel: 'Start/stop character A-D, body of digits and - $ : / . +',
    minLength: 3,
    checkDigit: 'none',
    example: 'A12345678B',
    description:
      'Legacy code still mandated by blood banks, libraries and photo labs.',
  },
  {
    id: 'interleaved2of5',
    label: 'Interleaved 2 of 5',
    kind: 'linear',
    bwipId: 'interleaved2of5',
    zplCommand: '^B2',
    eplCode: 'J',
    charset: DIGITS,
    charsetLabel: 'Digits only',
    minLength: 2,
    requiresEvenLength: true,
    checkDigit: 'none',
    example: '12345670',
    description:
      'Compact numeric code that encodes digit pairs; requires an even payload length.',
  },
  {
    id: 'industrial2of5',
    label: 'Industrial / Standard 2 of 5',
    kind: 'linear',
    bwipId: 'industrial2of5',
    zplCommand: '^BI',
    zplAliases: ['^BJ'],
    charset: DIGITS,
    charsetLabel: 'Digits only',
    minLength: 1,
    checkDigit: 'none',
    example: '1234567',
    description: 'Non-interleaved numeric code used in warehousing and film.',
  },
  {
    id: 'itf14',
    label: 'ITF-14 (shipping container)',
    kind: 'linear',
    bwipId: 'itf14',
    charset: DIGITS,
    charsetLabel: 'Digits only',
    fixedLengths: [13, 14],
    checkDigit: 'mod10',
    gs1: true,
    example: '1234567890123',
    description:
      'GTIN-14 carton code, printed with bearer bars on corrugated packaging.',
  },
  {
    id: 'msi',
    label: 'MSI Plessey',
    kind: 'linear',
    bwipId: 'msi',
    zplCommand: '^BM',
    eplCode: 'M',
    charset: DIGITS,
    charsetLabel: 'Digits only',
    minLength: 1,
    checkDigit: 'internal',
    example: '80523',
    description: 'Inventory/shelf-label code common in retail back rooms.',
  },
  {
    id: 'plessey',
    label: 'Plessey',
    kind: 'linear',
    bwipId: 'plessey',
    zplCommand: '^BP',
    eplCode: 'N',
    charset: /^[0-9A-Fa-f]+$/,
    charsetLabel: 'Hexadecimal digits',
    minLength: 1,
    checkDigit: 'internal',
    example: '01234ABCD',
    description: 'Early library-automation code, still seen on legacy stock.',
  },
  {
    id: 'ean13',
    label: 'EAN-13',
    kind: 'linear',
    bwipId: 'ean13',
    zplCommand: '^BE',
    eplCode: '8',
    charset: DIGITS,
    charsetLabel: 'Digits only',
    fixedLengths: [12, 13],
    checkDigit: 'mod10',
    gs1: true,
    example: '590123412345',
    description: 'Retail point-of-sale article number used outside the US.',
  },
  {
    id: 'ean8',
    label: 'EAN-8',
    kind: 'linear',
    bwipId: 'ean8',
    zplCommand: '^B8',
    eplCode: '9',
    charset: DIGITS,
    charsetLabel: 'Digits only',
    fixedLengths: [7, 8],
    checkDigit: 'mod10',
    gs1: true,
    example: '9638507',
    description: 'Short EAN for small retail packs.',
  },
  {
    id: 'upca',
    label: 'UPC-A',
    kind: 'linear',
    bwipId: 'upca',
    zplCommand: '^BU',
    eplCode: 'UA0',
    charset: DIGITS,
    charsetLabel: 'Digits only',
    fixedLengths: [11, 12],
    checkDigit: 'mod10',
    gs1: true,
    example: '01234567890',
    description: 'North-American retail point-of-sale code.',
  },
  {
    id: 'upce',
    label: 'UPC-E',
    kind: 'linear',
    bwipId: 'upce',
    zplCommand: '^B9',
    eplCode: 'UE0',
    charset: DIGITS,
    charsetLabel: 'Digits only',
    fixedLengths: [6, 7, 8],
    checkDigit: 'mod10',
    gs1: true,
    example: '0123456',
    description: 'Zero-suppressed UPC for packages too small for UPC-A.',
  },
  {
    id: 'postnet',
    label: 'POSTNET',
    kind: 'postal',
    bwipId: 'postnet',
    zplCommand: '^BZ',
    eplCode: 'P',
    charset: DIGITS,
    charsetLabel: 'Digits only',
    fixedLengths: [5, 6, 9, 10, 11, 12],
    checkDigit: 'mod10-flat',
    example: '55555',
    description: 'USPS ZIP+4 delivery-point code (height-modulated bars).',
  },
  {
    id: 'planet',
    label: 'PLANET',
    kind: 'postal',
    bwipId: 'planet',
    zplCommand: '^B5',
    charset: DIGITS,
    charsetLabel: 'Digits only',
    fixedLengths: [11, 12, 13, 14],
    checkDigit: 'mod10-flat',
    example: '01234567890',
    description: 'USPS confirmation-services companion to POSTNET.',
  },
  {
    id: 'qrcode',
    label: 'QR Code',
    kind: '2d',
    bwipId: 'qrcode',
    zplCommand: '^BQ',
    epl2dCode: 'Q',
    charset: ANY,
    charsetLabel: 'Any text (UTF-8 byte mode)',
    minLength: 1,
    maxLength: 4296,
    checkDigit: 'internal',
    example: 'https://example.com/asset/42',
    description:
      'High-capacity matrix code with four error-correction levels (L/M/Q/H).',
  },
  {
    id: 'datamatrix',
    label: 'Data Matrix',
    kind: '2d',
    bwipId: 'datamatrix',
    zplCommand: '^BX',
    epl2dCode: 'D',
    charset: ANY,
    charsetLabel: 'Any text',
    minLength: 1,
    maxLength: 2335,
    checkDigit: 'internal',
    example: 'PN:4711;LOT:A12',
    description:
      'Compact matrix code favoured for direct part marking and small electronics labels.',
  },
  {
    id: 'pdf417',
    label: 'PDF417',
    kind: '2d',
    bwipId: 'pdf417',
    zplCommand: '^B7',
    epl2dCode: 'P',
    charset: ANY,
    charsetLabel: 'Any text',
    minLength: 1,
    checkDigit: 'internal',
    example: 'PDF417 carries structured documents',
    description:
      'Stacked linear code used by driving licences, boarding passes and shipping manifests.',
  },
  {
    id: 'micropdf417',
    label: 'MicroPDF417',
    kind: '2d',
    bwipId: 'micropdf417',
    zplCommand: '^BF',
    charset: ANY,
    charsetLabel: 'Any text',
    minLength: 1,
    checkDigit: 'internal',
    example: 'MICRO-PDF',
    description: 'Space-efficient PDF417 variant for small healthcare labels.',
  },
  {
    id: 'aztec',
    label: 'Aztec Code',
    kind: '2d',
    bwipId: 'azteccode',
    zplCommand: '^BO',
    epl2dCode: 'A',
    charset: ANY,
    charsetLabel: 'Any text',
    minLength: 1,
    checkDigit: 'internal',
    example: 'AZTEC-TICKET-001',
    description:
      'Matrix code with no quiet-zone requirement - rail and airline tickets.',
  },
  {
    id: 'maxicode',
    label: 'MaxiCode',
    kind: '2d',
    bwipId: 'maxicode',
    zplCommand: '^BD',
    epl2dCode: 'M',
    charset: ANY,
    charsetLabel: 'Structured carrier message',
    minLength: 1,
    checkDigit: 'internal',
    example: 'UPS parcel message',
    description: 'Fixed-size hexagonal code used by UPS for parcel sortation.',
  },
  {
    id: 'gs1databar',
    label: 'GS1 DataBar (RSS)',
    kind: 'linear',
    bwipId: 'databaromni',
    zplCommand: '^BR',
    charset: DIGITS,
    charsetLabel: 'Digits only (GTIN-13 payload)',
    fixedLengths: [13, 14],
    checkDigit: 'mod10',
    gs1: true,
    example: '0123456789012',
    description:
      'Small omnidirectional GS1 code for fresh food and coupon labels.',
  },
];

const BY_ID = new Map<string, SymbologySpec>(SYMBOLOGIES.map((s) => [s.id, s]));

const BY_ZPL = new Map<string, SymbologySpec>();
for (const spec of SYMBOLOGIES) {
  if (spec.zplCommand && !BY_ZPL.has(spec.zplCommand)) {
    BY_ZPL.set(spec.zplCommand, spec);
  }
  for (const alias of spec.zplAliases ?? []) {
    if (!BY_ZPL.has(alias)) {
      BY_ZPL.set(alias, spec);
    }
  }
}

export function findSymbology(id: string | undefined): SymbologySpec | undefined {
  return id ? BY_ID.get(id) : undefined;
}

export function symbologyForZplCommand(
  command: string,
): SymbologySpec | undefined {
  return BY_ZPL.get(command.toUpperCase());
}

export function bwipIdFor(id: BarcodeSymbology): string {
  return BY_ID.get(id)?.bwipId ?? 'code128';
}

export function symbologiesByKind(kind: BarcodeKind): SymbologySpec[] {
  return SYMBOLOGIES.filter((s) => s.kind === kind);
}

/** Markdown summary used by hovers and the barcode studio. */
export function describeSymbology(spec: SymbologySpec): string {
  const kindLabel =
    spec.kind === '2d' ? '2-D matrix' : spec.kind === 'postal' ? 'postal' : 'linear';
  const lines = [
    `**${spec.label}** — ${kindLabel} symbology`,
    '',
    spec.description,
    '',
    `- Characters: ${spec.charsetLabel}`,
  ];
  if (spec.fixedLengths) {
    lines.push(`- Length: ${spec.fixedLengths.join(' or ')} characters`);
  } else if (spec.minLength || spec.maxLength) {
    lines.push(
      `- Length: ${spec.minLength ?? 1}-${spec.maxLength ?? 'unbounded'} characters`,
    );
  }
  if (spec.checkDigit !== 'none' && spec.checkDigit !== 'internal') {
    lines.push(`- Check digit: ${spec.checkDigit}`);
  }
  if (spec.zplCommand) {
    lines.push(`- ZPL: \`${spec.zplCommand}\``);
  }
  if (spec.eplCode || spec.epl2dCode) {
    lines.push(`- EPL2: \`${spec.eplCode ?? spec.epl2dCode}\``);
  }
  lines.push(`- Example: \`${spec.example}\``);
  return lines.join('\n');
}
