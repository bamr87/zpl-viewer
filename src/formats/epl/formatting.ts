/**
 * EPL2 formatter.
 *
 * EPL is whitespace- and case-sensitive in ways ZPL is not: a command must
 * start in column one, and `B`/`b` (or `Q`/`q`) are different commands. So the
 * formatter only normalizes what is safe — indentation, trailing whitespace,
 * blank-line runs, spacing after commas outside quoted data, and the trailing
 * newline. Command case is never touched.
 */

import { tokenizeEpl } from './tokenizer';

export interface EplFormatOptions {
  /** Collapse runs of blank lines to at most one (default true). */
  collapseBlankLines?: boolean;
  /** Strip spaces after commas outside quoted strings (default true). */
  tightenParameters?: boolean;
}

function tightenLine(line: string): string {
  let out = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"' && line[i - 1] !== '\\') {
      inQuotes = !inQuotes;
      out += ch;
      continue;
    }
    if (!inQuotes && ch === ' ' && out.endsWith(',')) {
      continue;
    }
    out += ch;
  }
  return out;
}

export function formatEpl(
  source: string,
  options: EplFormatOptions = {},
): string {
  const collapseBlankLines = options.collapseBlankLines ?? true;
  const tighten = options.tightenParameters ?? true;

  const lines = source.split(/\r?\n/);
  const out: string[] = [];
  let blankRun = 0;

  for (const line of lines) {
    const trimmed = line.replace(/\s+$/, '');
    if (trimmed.trim().length === 0) {
      blankRun += 1;
      if (!collapseBlankLines || blankRun <= 1) {
        out.push('');
      }
      continue;
    }
    blankRun = 0;
    // A command must begin in column one; leading whitespace is an error on
    // most firmware, so it is always removed.
    const body = trimmed.replace(/^\s+/, '');
    out.push(tighten ? tightenLine(body) : body);
  }

  while (out.length > 0 && out[out.length - 1] === '') {
    out.pop();
  }
  return out.length > 0 ? out.join('\n') + '\n' : '';
}

/** True when the source parses into at least one recognizable EPL command. */
export function looksLikeEpl(source: string): boolean {
  return tokenizeEpl(source).length > 0;
}
