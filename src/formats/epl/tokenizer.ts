/**
 * EPL2 tokenizer.
 *
 * Unlike ZPL's caret-delimited stream, EPL2 is line-oriented: one command per
 * line, a one- or two-letter verb, comma-separated parameters, and an optional
 * trailing double-quoted data string. Case matters — `B` is a linear barcode
 * while `b` is a 2-D one, `Q` is form length while `q` is print width.
 */

export interface EplToken {
  /** Command verb exactly as written (case preserved). */
  name: string;
  /** Raw parameter text following the verb. */
  raw: string;
  /** Parameters; a trailing quoted string is included with quotes stripped. */
  args: string[];
  /** Contents of the trailing quoted string, when the command has one. */
  data?: string;
  /** Zero-based line index. */
  line: number;
  /** Offset of the verb in the source. */
  start: number;
  /** Offset just past the end of the line. */
  end: number;
}

/**
 * Two-letter verbs, listed so `LO50,50` is not read as `L` + `O50,50`.
 * Case-sensitive on purpose.
 */
export const EPL_TWO_LETTER_COMMANDS = [
  'LO',
  'LE',
  'LW',
  'LS',
  'GW',
  'GG',
  'GK',
  'GM',
  'ZT',
  'ZB',
  'JF',
  'JB',
  'OD',
  'OH',
  'OR',
  'FK',
  'FS',
  'FR',
  'FE',
  'EI',
  'EK',
  'UN',
  'UP',
  'TD',
  'TS',
  'VB',
  'WY',
  'PA',
  'ER',
  'NA',
];

const TWO_LETTER = new Set(EPL_TWO_LETTER_COMMANDS);

function splitArgs(raw: string): { args: string[]; data?: string } {
  const args: string[] = [];
  let current = '';
  let inQuotes = false;
  let data: string | undefined;
  let currentIsQuoted = false;

  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (inQuotes) {
      if (ch === '\\' && (raw[i + 1] === '"' || raw[i + 1] === '\\')) {
        current += raw[i + 1];
        i += 1;
        continue;
      }
      if (ch === '"') {
        inQuotes = false;
        continue;
      }
      current += ch;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      currentIsQuoted = true;
      continue;
    }
    if (ch === ',') {
      args.push(current.trim());
      if (currentIsQuoted) {
        data = current;
      }
      current = '';
      currentIsQuoted = false;
      continue;
    }
    current += ch;
  }
  if (current.length > 0 || currentIsQuoted || args.length > 0) {
    args.push(currentIsQuoted ? current : current.trim());
    if (currentIsQuoted) {
      data = current;
    }
  }
  return { args, data };
}

/** Parses one line into a token, or nothing when it is blank or a comment. */
function tokenizeLine(
  line: string,
  lineIndex: number,
  lineStart: number,
): EplToken | undefined {
  const leading = line.match(/^\s*/)?.[0].length ?? 0;
  const body = line.slice(leading);
  if (body.length === 0 || body.startsWith(';')) {
    return undefined; // blank line or comment
  }

  let name = '';
  const two = body.slice(0, 2);
  if (/^[A-Za-z]{2}$/.test(two) && TWO_LETTER.has(two.toUpperCase())) {
    name = two.toUpperCase();
  } else if (/^[A-Za-z?]/.test(body)) {
    name = body[0];
  } else {
    return undefined; // not a command line
  }

  const raw = body.slice(name.length).replace(/\s+$/, '');
  const { args, data } = splitArgs(raw);
  return {
    name,
    raw,
    args,
    data,
    line: lineIndex,
    start: lineStart + leading,
    end: lineStart + line.length,
  };
}

export function tokenizeEpl(source: string): EplToken[] {
  const tokens: EplToken[] = [];
  let lineStart = 0;
  let lineIndex = 0;

  while (lineStart <= source.length) {
    const newline = source.indexOf('\n', lineStart);
    const lineEnd = newline < 0 ? source.length : newline;
    const raw = source.slice(lineStart, lineEnd);
    // A CRLF terminator is two characters, so offsets have to come from the
    // source itself: deriving them from the line's own length drifts by one
    // per preceding line, which lands diagnostics and hovers on the wrong
    // characters in any file written on Windows.
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;

    const token = tokenizeLine(line, lineIndex, lineStart);
    if (token) {
      tokens.push(token);
    }

    lineIndex += 1;
    if (newline < 0) {
      break;
    }
    lineStart = newline + 1;
  }

  return tokens;
}

/** Finds the token covering a source offset, if any. */
export function eplTokenAt(
  tokens: EplToken[],
  offset: number,
): EplToken | undefined {
  return tokens.find((token) => offset >= token.start && offset <= token.end);
}
