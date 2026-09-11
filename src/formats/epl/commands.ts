/**
 * EPL2 command reference, sourced from the EPL2 Programmer's Manual. Feeds
 * hover documentation, completion and validation for `.epl` documents.
 */

export interface EplParameter {
  name: string;
  description: string;
  values?: string;
  default?: string;
  optional?: boolean;
}

export type EplCategory =
  | 'label'
  | 'field'
  | 'font'
  | 'barcode'
  | 'graphic'
  | 'format'
  | 'control'
  | 'misc';

export interface EplCommand {
  /** Verb as written, case-sensitive (`B` and `b` are different commands). */
  name: string;
  title: string;
  description: string;
  category: EplCategory;
  parameters?: EplParameter[];
  example?: string;
}

export const EPL_COMMANDS: EplCommand[] = [
  {
    name: 'N',
    title: 'Clear Image Buffer',
    description:
      'Clears the image buffer. Every label format starts with `N` — leaving it out prints the previous label on top of the new one.',
    category: 'label',
    example: 'N\nA50,50,0,3,1,1,N,"HELLO"\nP1',
  },
  {
    name: 'P',
    title: 'Print Label',
    description:
      'Prints the contents of the image buffer. Ends the label the way `^XZ` ends a ZPL format.',
    category: 'label',
    parameters: [
      { name: 'p1', description: 'Number of label sets.', default: '1' },
      {
        name: 'p2',
        description: 'Copies of each label (with counters).',
        optional: true,
      },
    ],
    example: 'P1',
  },
  {
    name: 'q',
    title: 'Set Label Width',
    description: 'Sets the printable label width in dots.',
    category: 'label',
    parameters: [{ name: 'width', description: 'Label width in dots.' }],
    example: 'q812',
  },
  {
    name: 'Q',
    title: 'Set Form Length',
    description:
      'Sets the label length and the gap/notch between labels, in dots.',
    category: 'label',
    parameters: [
      { name: 'length', description: 'Label length in dots.' },
      {
        name: 'gap',
        description: 'Gap length, or `B`/`Z` forms for black-mark stock.',
        optional: true,
      },
    ],
    example: 'Q406,24',
  },
  {
    name: 'A',
    title: 'ASCII Text',
    description: 'Places a line of text on the label.',
    category: 'field',
    parameters: [
      { name: 'x', description: 'Horizontal start position in dots.' },
      { name: 'y', description: 'Vertical start position in dots.' },
      {
        name: 'rotation',
        description: 'Rotation.',
        values: '0 = none, 1 = 90°, 2 = 180°, 3 = 270°',
      },
      {
        name: 'font',
        description: 'Font selection.',
        values: '1-5 (1 = 8x12 dots … 5 = 32x48 dots)',
      },
      { name: 'hMult', description: 'Horizontal multiplier.', values: '1-8' },
      { name: 'vMult', description: 'Vertical multiplier.', values: '1-9' },
      {
        name: 'reverse',
        description: 'Reverse image.',
        values: 'N = normal, R = reverse',
      },
      { name: 'data', description: 'Quoted text to print.' },
    ],
    example: 'A50,100,0,3,1,1,N,"SHIP TO"',
  },
  {
    name: 'B',
    title: 'Bar Code',
    description: 'Prints a linear (1-D) barcode.',
    category: 'barcode',
    parameters: [
      { name: 'x', description: 'Horizontal start position in dots.' },
      { name: 'y', description: 'Vertical start position in dots.' },
      { name: 'rotation', description: 'Rotation.', values: '0-3' },
      {
        name: 'type',
        description: 'Barcode selection.',
        values: '0 = Code 39, 1 = Code 93, 3 = Code 128, 8 = EAN-13, 9 = EAN-8, K = Codabar, J = I 2 of 5, UA0 = UPC-A',
      },
      { name: 'narrow', description: 'Narrow bar width in dots.' },
      { name: 'wide', description: 'Wide bar width in dots.' },
      { name: 'height', description: 'Bar height in dots.' },
      {
        name: 'hri',
        description: 'Human readable interpretation.',
        values: 'B = print, N = do not print',
      },
      { name: 'data', description: 'Quoted barcode data.' },
    ],
    example: 'B50,200,0,3,2,6,100,B,"1234567890"',
  },
  {
    name: 'b',
    title: '2-D Bar Code',
    description:
      'Prints a 2-D symbol. The type selector is followed by type-specific options such as `s` (module size), `m` (model) and `e` (error correction).',
    category: 'barcode',
    parameters: [
      { name: 'x', description: 'Horizontal start position in dots.' },
      { name: 'y', description: 'Vertical start position in dots.' },
      {
        name: 'type',
        description: 'Symbol type.',
        values: 'Q = QR Code, D = Data Matrix, P = PDF417, A = Aztec, M = MaxiCode',
      },
      {
        name: 'options',
        description: 'Type-specific options, e.g. `s7` module size, `eM` error correction.',
        optional: true,
      },
      { name: 'data', description: 'Quoted symbol data.' },
    ],
    example: 'b300,100,Q,m2,s6,"https://example.com"',
  },
  {
    name: 'X',
    title: 'Draw Box',
    description: 'Draws a box (rectangle outline) of a given line thickness.',
    category: 'graphic',
    parameters: [
      { name: 'x', description: 'Upper-left X in dots.' },
      { name: 'y', description: 'Upper-left Y in dots.' },
      { name: 'thickness', description: 'Line thickness in dots.' },
      { name: 'x2', description: 'Lower-right X in dots.' },
      { name: 'y2', description: 'Lower-right Y in dots.' },
    ],
    example: 'X20,20,3,780,380',
  },
  {
    name: 'LO',
    title: 'Line Draw Black',
    description: 'Draws a filled black line/rectangle (OR with the buffer).',
    category: 'graphic',
    parameters: [
      { name: 'x', description: 'Upper-left X in dots.' },
      { name: 'y', description: 'Upper-left Y in dots.' },
      { name: 'width', description: 'Horizontal length in dots.' },
      { name: 'height', description: 'Vertical length in dots.' },
    ],
    example: 'LO20,180,760,3',
  },
  {
    name: 'LE',
    title: 'Line Draw White',
    description: 'Draws a white (exclusive OR) line, erasing what it crosses.',
    category: 'graphic',
    parameters: [
      { name: 'x', description: 'Upper-left X in dots.' },
      { name: 'y', description: 'Upper-left Y in dots.' },
      { name: 'width', description: 'Horizontal length in dots.' },
      { name: 'height', description: 'Vertical length in dots.' },
    ],
    example: 'LE100,100,50,50',
  },
  {
    name: 'LW',
    title: 'Line Draw White (OR)',
    description: 'Draws a white line that replaces the pixels beneath it.',
    category: 'graphic',
    parameters: [
      { name: 'x', description: 'Upper-left X in dots.' },
      { name: 'y', description: 'Upper-left Y in dots.' },
      { name: 'width', description: 'Horizontal length in dots.' },
      { name: 'height', description: 'Vertical length in dots.' },
    ],
  },
  {
    name: 'GW',
    title: 'Direct Graphic Write',
    description:
      'Writes a raw 1-bit-per-pixel bitmap straight into the image buffer.',
    category: 'graphic',
    parameters: [
      { name: 'x', description: 'Upper-left X in dots.' },
      { name: 'y', description: 'Upper-left Y in dots.' },
      { name: 'bytesPerRow', description: 'Bytes of image data per row.' },
      { name: 'rows', description: 'Number of rows (print head dots).' },
      { name: 'data', description: 'Raw binary image data.' },
    ],
    example: 'GW50,50,2,16,<binary>',
  },
  {
    name: 'GG',
    title: 'Print Graphic',
    description: 'Prints a graphic previously stored in printer memory.',
    category: 'graphic',
    parameters: [
      { name: 'x', description: 'Upper-left X in dots.' },
      { name: 'y', description: 'Upper-left Y in dots.' },
      { name: 'name', description: 'Stored graphic name.' },
    ],
  },
  {
    name: 'GK',
    title: 'Delete Graphic',
    description: 'Deletes a stored graphic from printer memory.',
    category: 'graphic',
  },
  {
    name: 'S',
    title: 'Speed Select',
    description: 'Sets the print speed.',
    category: 'control',
    parameters: [{ name: 'speed', description: 'Speed setting.', values: '0-6' }],
    example: 'S4',
  },
  {
    name: 'D',
    title: 'Density',
    description: 'Sets print darkness/heat.',
    category: 'control',
    parameters: [{ name: 'density', description: 'Heat setting.', values: '0-15' }],
    example: 'D8',
  },
  {
    name: 'R',
    title: 'Reference Point',
    description:
      'Moves the origin of all subsequent fields — the EPL analogue of ZPL `^LH`.',
    category: 'label',
    parameters: [
      { name: 'x', description: 'Horizontal offset in dots.' },
      { name: 'y', description: 'Vertical offset in dots.' },
    ],
    example: 'R0,0',
  },
  {
    name: 'ZT',
    title: 'Print Direction Top',
    description: 'Prints from the top of the image buffer down.',
    category: 'format',
  },
  {
    name: 'ZB',
    title: 'Print Direction Bottom',
    description: 'Prints from the bottom of the image buffer up.',
    category: 'format',
  },
  {
    name: 'JF',
    title: 'Enable Backfeed',
    description: 'Enables top-of-form backfeed between labels.',
    category: 'format',
  },
  {
    name: 'JB',
    title: 'Disable Backfeed',
    description: 'Disables top-of-form backfeed.',
    category: 'format',
  },
  {
    name: 'OD',
    title: 'Direct Thermal Mode',
    description: 'Selects direct thermal printing (no ribbon).',
    category: 'control',
  },
  {
    name: 'I',
    title: 'Character Set Select',
    description: 'Selects the code page and country code for text fields.',
    category: 'format',
    parameters: [
      { name: 'p1', description: 'Number of data bits.', values: '7 or 8' },
      { name: 'p2', description: 'Printer code page.' },
      { name: 'p3', description: 'KDU country code.' },
    ],
    example: 'I8,1,001',
  },
  {
    name: 'f',
    title: 'Form Feed / Cut Position',
    description: 'Sets the cut or tear-off position.',
    category: 'control',
  },
  {
    name: 'V',
    title: 'Define Variable',
    description: 'Defines a variable field for KDU data entry forms.',
    category: 'field',
  },
  {
    name: 'C',
    title: 'Counter',
    description: 'Defines an auto-incrementing counter field.',
    category: 'field',
  },
  {
    name: 'FK',
    title: 'Delete Form',
    description: 'Deletes a stored form from printer memory.',
    category: 'control',
  },
  {
    name: 'FS',
    title: 'Store Form',
    description: 'Stores the current format as a named form.',
    category: 'control',
  },
  {
    name: 'FR',
    title: 'Retrieve Form',
    description: 'Recalls a stored form.',
    category: 'control',
  },
  {
    name: 'UN',
    title: 'Disable Error Reporting',
    description: 'Turns off error reporting over the serial port.',
    category: 'control',
  },
  {
    name: 'UP',
    title: 'Enable Error Reporting',
    description: 'Turns on error reporting over the serial port.',
    category: 'control',
  },
  {
    name: 'TD',
    title: 'Define Date/Time Field',
    description: 'Formats the real-time-clock value for use in a text field.',
    category: 'field',
  },
  {
    name: '?',
    title: 'Download Variables',
    description: 'Begins a variable download for a stored form.',
    category: 'control',
  },
];

const INDEX = new Map<string, EplCommand>();
for (const command of EPL_COMMANDS) {
  INDEX.set(command.name, command);
}

export function findEplCommand(name: string): EplCommand | undefined {
  if (!name) {
    return undefined;
  }
  return INDEX.get(name) ?? INDEX.get(name.toUpperCase());
}

export function renderEplCommandMarkdown(cmd: EplCommand): string {
  const lines: string[] = [];
  lines.push(`**\`${cmd.name}\` — ${cmd.title}**  `);
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
    lines.push('', '**Example**', '', '```epl', cmd.example, '```');
  }
  return lines.join('\n');
}

export const __test = {
  commandIndex: INDEX,
};
