/**
 * Lightweight tokenizer/parser for ZPL II source text.
 * ZPL commands start with `^` (format commands) or `~` (control commands) and
 * are followed by a 1-3 character command identifier and an optional comma
 * separated parameter list.
 */

export interface ZplToken {
  /** Full command with prefix, e.g. "^FO" */
  command: string;
  prefix: '^' | '~';
  /** Command identifier without prefix, e.g. "FO" */
  name: string;
  /** Raw parameter string (text between command and next command). */
  raw: string;
  /** Comma-separated argument list (may be empty). */
  args: string[];
  /** Offset of the command prefix in the source document. */
  start: number;
  /** Offset immediately after the token (next prefix or EOF). */
  end: number;
}

function parseCommandName(
  source: string,
  start: number,
): { name: string; length: number } | undefined {
  const c1 = source[start];
  if (!c1 || !/[A-Za-z]/.test(c1)) {
    return undefined;
  }
  const c2 = source[start + 1];
  if (!c2 || !/[A-Za-z0-9@]/.test(c2)) {
    return { name: c1.toUpperCase(), length: 1 };
  }

  let name = (c1 + c2).toUpperCase();
  let length = 2;

  // Font commands can embed orientation in the command token itself:
  //   ^A0N,30,30   ^AAN,20,20   ^A@N,...
  // Preserve the third orientation character when present.
  const c3 = source[start + 2];
  if (c1.toUpperCase() === 'A' && c3 && /[NRIB]/i.test(c3)) {
    name = (c1 + c2 + c3).toUpperCase();
    length = 3;
  }

  return { name, length };
}

/**
 * Tokenize a ZPL source string.
 * Tokens do not span across `^` or `~` boundaries; `^FD` data runs until the
 * next prefix character so that arbitrary data can be captured.
 */
export function tokenize(source: string): ZplToken[] {
  const tokens: ZplToken[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch !== '^' && ch !== '~') {
      i += 1;
      continue;
    }
    const prefix = ch as '^' | '~';
    const start = i;
    i += 1;
    const parsed = parseCommandName(source, i);
    if (!parsed) {
      continue;
    }
    const name = parsed.name;
    i += parsed.length;
    const rawStart = i;
    while (i < source.length && source[i] !== '^' && source[i] !== '~') {
      i += 1;
    }
    const raw = source.slice(rawStart, i);
    const args = raw === '' ? [] : raw.split(',');
    tokens.push({
      command: prefix + name,
      prefix,
      name,
      raw,
      args,
      start,
      end: i,
    });
  }
  return tokens;
}

/**
 * Find the ZPL token containing a given character offset, if any.
 */
export function tokenAt(tokens: ZplToken[], offset: number): ZplToken | undefined {
  for (const token of tokens) {
    if (offset >= token.start && offset < token.end) {
      return token;
    }
  }
  return undefined;
}
