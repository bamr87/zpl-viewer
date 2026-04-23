/**
 * ZPL II command reference. Sourced from the Zebra ZPL II Programming Guide.
 * Each entry provides documentation surfaced via hover and completion providers.
 */

export interface ZplParameter {
  name: string;
  description: string;
  values?: string;
  default?: string;
  optional?: boolean;
}

export interface ZplCommand {
  /** Command without the leading prefix, e.g. "FO" */
  name: string;
  /** "^" for format commands, "~" for control commands. */
  prefix: '^' | '~';
  title: string;
  description: string;
  parameters?: ZplParameter[];
  example?: string;
  category:
    | 'label'
    | 'field'
    | 'font'
    | 'barcode'
    | 'graphic'
    | 'format'
    | 'control'
    | 'misc';
}

export const ZPL_COMMANDS: ZplCommand[] = [
  // ---------- Label / format boundaries ----------
  {
    name: 'XA',
    prefix: '^',
    title: 'Start Format',
    description:
      'Indicates the start of a ZPL II label format. Must be the first command of a label.',
    category: 'label',
    example: '^XA\n^FO50,50^A0N,30,30^FDHello^FS\n^XZ',
  },
  {
    name: 'XZ',
    prefix: '^',
    title: 'End Format',
    description:
      'Indicates the end of a ZPL II label format. Pair with `^XA`.',
    category: 'label',
  },
  {
    name: 'XB',
    prefix: '^',
    title: 'Suppress Backfeed',
    description: 'Suppresses backfeed between labels for this format.',
    category: 'label',
  },
  // ---------- Field commands ----------
  {
    name: 'FO',
    prefix: '^',
    title: 'Field Origin',
    description:
      'Sets the field origin (upper-left corner) relative to the label home.',
    parameters: [
      { name: 'x', description: 'X-axis location in dots.', values: '0 to 32000' },
      { name: 'y', description: 'Y-axis location in dots.', values: '0 to 32000' },
      {
        name: 'z',
        description: 'Justification (0=left, 1=right, 2=auto).',
        values: '0,1,2',
        optional: true,
      },
    ],
    example: '^FO50,100',
    category: 'field',
  },
  {
    name: 'FT',
    prefix: '^',
    title: 'Field Typeset',
    description:
      'Sets the field position using a baseline anchor (x = left, y = baseline).',
    parameters: [
      { name: 'x', description: 'X-axis location in dots.' },
      { name: 'y', description: 'Y-axis baseline location in dots.' },
    ],
    category: 'field',
  },
  {
    name: 'FD',
    prefix: '^',
    title: 'Field Data',
    description:
      'Defines the data string printed in the field. Terminated by `^FS`.',
    parameters: [
      { name: 'data', description: 'Printable characters. Cannot contain ^ or ~.' },
    ],
    example: '^FDHello, World^FS',
    category: 'field',
  },
  {
    name: 'FS',
    prefix: '^',
    title: 'Field Separator',
    description: 'Marks the end of a field definition.',
    category: 'field',
  },
  {
    name: 'FB',
    prefix: '^',
    title: 'Field Block',
    description: 'Wraps a text field into lines within a block.',
    parameters: [
      { name: 'width', description: 'Width of the text block in dots.' },
      { name: 'max_lines', description: 'Maximum number of lines (1-9999).' },
      {
        name: 'line_spacing',
        description: 'Added space between lines (-9999 to 9999).',
        optional: true,
      },
      {
        name: 'text_justification',
        description: 'L=left, C=center, R=right, J=justified.',
        optional: true,
      },
      {
        name: 'hanging_indent',
        description: 'Indent of second and subsequent lines.',
        optional: true,
      },
    ],
    category: 'field',
  },
  {
    name: 'FR',
    prefix: '^',
    title: 'Field Reverse Print',
    description: 'Prints the next field in reverse (white on black).',
    category: 'field',
  },
  {
    name: 'FH',
    prefix: '^',
    title: 'Field Hexadecimal Indicator',
    description:
      'Allows hexadecimal (\\xx) character entry within field data. Useful for non-ASCII.',
    parameters: [
      {
        name: 'hex_indicator',
        description: 'Hex indicator character (default `_`).',
        optional: true,
      },
    ],
    category: 'field',
  },
  {
    name: 'FX',
    prefix: '^',
    title: 'Comment',
    description:
      'Everything after `^FX` until the next `^` or `~` command is treated as a comment.',
    category: 'field',
    example: '^FX This is a comment^FS',
  },
  {
    name: 'FN',
    prefix: '^',
    title: 'Field Number',
    description: 'Numbers a field for recall or variable data.',
    parameters: [
      { name: 'number', description: 'Field number (0-9999).' },
    ],
    category: 'field',
  },
  {
    name: 'FV',
    prefix: '^',
    title: 'Field Variable',
    description: 'Prints variable data without erasing the format stored.',
    category: 'field',
  },
  {
    name: 'FW',
    prefix: '^',
    title: 'Field Orientation',
    description:
      'Sets default orientation for all fields: N=normal, R=rotated 90, I=inverted, B=rotated 270.',
    parameters: [
      { name: 'rotation', description: 'N, R, I, or B.', default: 'N' },
    ],
    category: 'field',
  },
  // ---------- Fonts ----------
  {
    name: 'A',
    prefix: '^',
    title: 'Scalable/Bitmapped Font',
    description:
      'Specifies font, orientation, and size. Format: `^A[font][orientation],[height],[width]`.',
    parameters: [
      { name: 'font', description: 'A-Z, 0 (scalable).' },
      { name: 'orientation', description: 'N, R, I, B.', default: 'N' },
      { name: 'height', description: 'Character height in dots.' },
      { name: 'width', description: 'Character width in dots.' },
    ],
    example: '^A0N,50,50',
    category: 'font',
  },
  {
    name: 'CF',
    prefix: '^',
    title: 'Change Default Font',
    description: 'Sets the default font used when no `^A` command is specified.',
    parameters: [
      { name: 'font', description: 'A-Z, 0.' },
      { name: 'height', description: 'Height in dots.', optional: true },
      { name: 'width', description: 'Width in dots.', optional: true },
    ],
    example: '^CF0,30,30',
    category: 'font',
  },
  {
    name: 'CI',
    prefix: '^',
    title: 'Change International Font/Encoding',
    description: 'Select an international font encoding (0-31, UTF-8=28).',
    parameters: [
      { name: 'encoding', description: 'Encoding number (0-31).' },
    ],
    category: 'font',
  },
  {
    name: 'CW',
    prefix: '^',
    title: 'Font Identifier',
    description: 'Assigns a single alphanumeric character to a stored font.',
    category: 'font',
  },
  // ---------- Barcodes ----------
  {
    name: 'BY',
    prefix: '^',
    title: 'Bar Code Field Default',
    description: 'Sets default bar code dimensions.',
    parameters: [
      { name: 'module_width', description: 'Narrow bar width (1-10 dots).', default: '2' },
      { name: 'ratio', description: 'Wide/narrow ratio (2.0-3.0).', default: '3.0' },
      { name: 'height', description: 'Bar code height in dots.' },
    ],
    example: '^BY2,3,100',
    category: 'barcode',
  },
  {
    name: 'BC',
    prefix: '^',
    title: 'Code 128 Bar Code',
    description: 'Prints a Code 128 barcode.',
    parameters: [
      { name: 'orientation', description: 'N, R, I, B.', default: 'N' },
      { name: 'height', description: 'Bar code height in dots.' },
      { name: 'print_interpretation', description: 'Y=yes, N=no.', default: 'Y' },
      { name: 'print_above', description: 'Y=yes, N=no.', default: 'N' },
      { name: 'check_digit', description: 'Y=yes, N=no.', default: 'N' },
      {
        name: 'mode',
        description: 'N=no mode, U=UCC case, A=auto, D=UCC/EAN.',
        default: 'N',
        optional: true,
      },
    ],
    example: '^BCN,100,Y,N,N',
    category: 'barcode',
  },
  {
    name: 'BQ',
    prefix: '^',
    title: 'QR Code Bar Code',
    description: 'Prints a QR code.',
    parameters: [
      { name: 'orientation', description: 'N (only valid).', default: 'N' },
      { name: 'model', description: '1 or 2.', default: '2' },
      { name: 'magnification', description: 'Size 1-10.', default: '2' },
      { name: 'error_correction', description: 'H, Q, M, L.', default: 'Q' },
      { name: 'mask', description: '0-7.', default: '7' },
    ],
    example: '^BQN,2,6',
    category: 'barcode',
  },
  {
    name: 'BX',
    prefix: '^',
    title: 'Data Matrix Bar Code',
    description: 'Prints a Data Matrix 2-D barcode.',
    parameters: [
      { name: 'orientation', description: 'N, R, I, B.', default: 'N' },
      { name: 'height', description: 'Dimensional height of individual symbol elements.' },
      { name: 'quality', description: 'Error correction level.' },
      { name: 'columns', description: 'Number of columns to encode (optional).', optional: true },
      { name: 'rows', description: 'Number of rows to encode (optional).', optional: true },
    ],
    category: 'barcode',
  },
  {
    name: 'B3',
    prefix: '^',
    title: 'Code 39 Bar Code',
    description: 'Prints a Code 39 barcode.',
    category: 'barcode',
  },
  {
    name: 'BE',
    prefix: '^',
    title: 'EAN-13 Bar Code',
    description: 'Prints an EAN-13 barcode.',
    category: 'barcode',
  },
  {
    name: 'BU',
    prefix: '^',
    title: 'UPC-A Bar Code',
    description: 'Prints a UPC-A barcode.',
    category: 'barcode',
  },
  {
    name: 'B7',
    prefix: '^',
    title: 'PDF417 Bar Code',
    description: 'Prints a PDF417 2-D barcode.',
    category: 'barcode',
  },
  {
    name: 'B8',
    prefix: '^',
    title: 'EAN-8 Bar Code',
    description: 'Prints an EAN-8 barcode.',
    category: 'barcode',
  },
  {
    name: 'B9',
    prefix: '^',
    title: 'Codabar Bar Code',
    description: 'Prints a Codabar barcode.',
    category: 'barcode',
  },
  // ---------- Graphics ----------
  {
    name: 'GB',
    prefix: '^',
    title: 'Graphic Box',
    description: 'Draws a box or line.',
    parameters: [
      { name: 'width', description: 'Box width in dots.' },
      { name: 'height', description: 'Box height in dots.' },
      { name: 'thickness', description: 'Border thickness in dots.' },
      { name: 'color', description: 'B=black, W=white.', optional: true, default: 'B' },
      { name: 'rounding', description: 'Degree of corner rounding (0-8).', optional: true },
    ],
    example: '^GB300,200,4',
    category: 'graphic',
  },
  {
    name: 'GC',
    prefix: '^',
    title: 'Graphic Circle',
    description: 'Draws a circle.',
    parameters: [
      { name: 'diameter', description: 'Circle diameter in dots.' },
      { name: 'thickness', description: 'Border thickness.' },
      { name: 'color', description: 'B or W.', optional: true },
    ],
    category: 'graphic',
  },
  {
    name: 'GD',
    prefix: '^',
    title: 'Graphic Diagonal Line',
    description: 'Draws a diagonal line.',
    category: 'graphic',
  },
  {
    name: 'GE',
    prefix: '^',
    title: 'Graphic Ellipse',
    description: 'Draws an ellipse.',
    category: 'graphic',
  },
  {
    name: 'GF',
    prefix: '^',
    title: 'Graphic Field',
    description: 'Prints a graphic image. Format: `^GFa,b,c,d,data`.',
    parameters: [
      { name: 'compression_type', description: 'A=ASCII hex, B=binary, C=compressed.' },
      { name: 'binary_byte_count', description: 'Total binary bytes.' },
      { name: 'graphic_field_count', description: 'Total bytes in graphic.' },
      { name: 'bytes_per_row', description: 'Number of bytes in one row.' },
      { name: 'data', description: 'Data bits.' },
    ],
    category: 'graphic',
  },
  {
    name: 'IL',
    prefix: '^',
    title: 'Image Load',
    description: 'Loads a stored image from printer memory.',
    category: 'graphic',
  },
  {
    name: 'IS',
    prefix: '^',
    title: 'Image Save',
    description: 'Saves the current label as an image.',
    category: 'graphic',
  },
  // ---------- Label configuration ----------
  {
    name: 'LH',
    prefix: '^',
    title: 'Label Home',
    description: 'Sets the label home position (upper-left).',
    parameters: [
      { name: 'x', description: 'X-axis position (0-32000).' },
      { name: 'y', description: 'Y-axis position (0-32000).' },
    ],
    example: '^LH30,30',
    category: 'format',
  },
  {
    name: 'LL',
    prefix: '^',
    title: 'Label Length',
    description: 'Defines the label length in dots.',
    parameters: [
      { name: 'length', description: 'Label length in dots.' },
    ],
    category: 'format',
  },
  {
    name: 'LS',
    prefix: '^',
    title: 'Label Shift',
    description: 'Horizontal shift of entire label.',
    category: 'format',
  },
  {
    name: 'LT',
    prefix: '^',
    title: 'Label Top',
    description: 'Moves the entire label format vertically.',
    category: 'format',
  },
  {
    name: 'PW',
    prefix: '^',
    title: 'Print Width',
    description: 'Sets the print width in dots.',
    parameters: [{ name: 'width', description: 'Print width in dots.' }],
    example: '^PW812',
    category: 'format',
  },
  {
    name: 'PR',
    prefix: '^',
    title: 'Print Rate',
    description: 'Sets print, slew, and backfeed speeds.',
    category: 'format',
  },
  {
    name: 'PQ',
    prefix: '^',
    title: 'Print Quantity',
    description: 'Number of labels to print.',
    parameters: [
      { name: 'quantity', description: 'Total labels.' },
      { name: 'pause_and_cut', description: 'Pause and cut count.', optional: true },
      { name: 'replicates', description: 'Replicates per serial number.', optional: true },
      { name: 'override_pause', description: 'Y or N.', optional: true },
    ],
    example: '^PQ1,0,0,N',
    category: 'format',
  },
  {
    name: 'PO',
    prefix: '^',
    title: 'Print Orientation',
    description: 'Inverts the label 180 degrees. Values: N (normal), I (inverted).',
    category: 'format',
  },
  {
    name: 'MD',
    prefix: '~',
    title: 'Media Darkness',
    description: 'Sets the media darkness (print head temperature).',
    category: 'control',
  },
  {
    name: 'JC',
    prefix: '~',
    title: 'Set Media Sensor Calibration',
    description: 'Forces the printer to recalibrate the media sensors.',
    category: 'control',
  },
  {
    name: 'JR',
    prefix: '~',
    title: 'Power-On Reset',
    description: 'Resets printer as if power-cycled.',
    category: 'control',
  },
  {
    name: 'HS',
    prefix: '~',
    title: 'Host Status Return',
    description: 'Returns printer status to the host.',
    category: 'control',
  },
];

const COMMAND_INDEX = new Map<string, ZplCommand>();
for (const cmd of ZPL_COMMANDS) {
  COMMAND_INDEX.set(`${cmd.prefix}${cmd.name}`, cmd);
}

export function findCommand(token: string): ZplCommand | undefined {
  if (!token) {
    return undefined;
  }
  const upper = token.toUpperCase();
  if (COMMAND_INDEX.has(upper)) {
    return COMMAND_INDEX.get(upper);
  }
  // Handle `^A` font family commands: ^A0, ^AA, etc.
  if (/^\^A[0-9A-Z@]?/.test(upper)) {
    return COMMAND_INDEX.get('^A');
  }
  return undefined;
}

export function renderCommandMarkdown(cmd: ZplCommand): string {
  const lines: string[] = [];
  lines.push(`**\`${cmd.prefix}${cmd.name}\` — ${cmd.title}**  `);
  lines.push(`_${cmd.category}_`);
  lines.push('');
  lines.push(cmd.description);
  if (cmd.parameters && cmd.parameters.length > 0) {
    lines.push('');
    lines.push('**Parameters**');
    lines.push('');
    lines.push('| # | Name | Description | Default |');
    lines.push('|---|------|-------------|---------|');
    cmd.parameters.forEach((p, i) => {
      const name = p.optional ? `${p.name} _(optional)_` : p.name;
      lines.push(
        `| ${i + 1} | \`${name}\` | ${p.description}${
          p.values ? ` (${p.values})` : ''
        } | ${p.default ? `\`${p.default}\`` : ''} |`,
      );
    });
  }
  if (cmd.example) {
    lines.push('');
    lines.push('**Example**');
    lines.push('');
    lines.push('```zpl');
    lines.push(cmd.example);
    lines.push('```');
  }
  return lines.join('\n');
}

export const __test = {
  commandIndex: COMMAND_INDEX,
};
