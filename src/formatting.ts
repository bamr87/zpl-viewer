import { tokenize } from './zplParser';

export interface FormatOptions {
  uppercase: boolean;
  oneCommandPerLine: boolean;
  indent?: string;
}

export function formatZpl(source: string, options: FormatOptions): string {
  const indentUnit = options.indent ?? '  ';
  const tokens = tokenize(source);
  if (tokens.length === 0) {
    return source;
  }

  const parts: string[] = [];
  let depth = 0;

  for (const token of tokens) {
    const name = options.uppercase ? token.name.toUpperCase() : token.name;
    const cmd = token.prefix + name;

    if (cmd === '^XZ') {
      depth = Math.max(0, depth - 1);
    }

    const indent = options.oneCommandPerLine ? indentUnit.repeat(depth) : '';
    const rendered = cmd + token.raw;
    if (options.oneCommandPerLine) {
      parts.push(indent + rendered);
    } else {
      parts.push(rendered);
    }

    if (cmd === '^XA') {
      depth += 1;
    }
  }

  if (options.oneCommandPerLine) {
    return parts.join('\n') + '\n';
  }
  return parts.join('');
}
