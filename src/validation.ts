import { tokenize } from './zplParser';
import { findCommand } from './zplCommands';

export type DiagnosticSeverityName = 'warning' | 'information';

export interface ZplValidationDiagnostic {
  start: number;
  end: number;
  message: string;
  severity: DiagnosticSeverityName;
}

export function validateZpl(text: string): ZplValidationDiagnostic[] {
  const diagnostics: ZplValidationDiagnostic[] = [];
  const tokens = tokenize(text);

  let depth = 0;
  let openStart: number | undefined;
  let pendingFieldStart: number | undefined;

  for (const token of tokens) {
    const cmd = findCommand(token.command);

    if (!cmd) {
      diagnostics.push({
        start: token.start,
        end: token.end,
        message: `Unknown ZPL command \`${token.command}\`.`,
        severity: 'warning',
      });
      continue;
    }

    if (token.command === '^XA') {
      if (depth > 0) {
        diagnostics.push({
          start: token.start,
          end: token.end,
          message: 'Nested `^XA` without preceding `^XZ`.',
          severity: 'warning',
        });
      }
      depth += 1;
      openStart = token.start;
      continue;
    }

    if (token.command === '^XZ') {
      if (depth === 0) {
        diagnostics.push({
          start: token.start,
          end: token.end,
          message: '`^XZ` without matching `^XA`.',
          severity: 'warning',
        });
      } else {
        depth -= 1;
        openStart = undefined;
        if (pendingFieldStart !== undefined) {
          diagnostics.push({
            start: pendingFieldStart,
            end: token.start,
            message: '`^FD` field not terminated with `^FS` before end of label.',
            severity: 'warning',
          });
          pendingFieldStart = undefined;
        }
      }
      continue;
    }

    if (token.command === '^FD') {
      pendingFieldStart = token.start;
    } else if (token.command === '^FS') {
      pendingFieldStart = undefined;
    }

    if (cmd.parameters && cmd.parameters.length > 0 && token.raw.length > 0) {
      const argCount = token.args.length;
      const required = cmd.parameters.filter((p) => !p.optional).length;
      const max = cmd.parameters.length;
      if (argCount > max) {
        diagnostics.push({
          start: token.start,
          end: token.end,
          message: `\`${token.command}\` accepts up to ${max} parameters, got ${argCount}.`,
          severity: 'information',
        });
      } else if (argCount < required && argCount !== 0) {
        diagnostics.push({
          start: token.start,
          end: token.end,
          message: `\`${token.command}\` requires ${required} parameter(s), got ${argCount}.`,
          severity: 'information',
        });
      }
    }
  }

  if (depth > 0 && openStart !== undefined) {
    diagnostics.push({
      start: openStart,
      end: Math.min(openStart + 3, text.length),
      message: '`^XA` is not closed with `^XZ`.',
      severity: 'warning',
    });
  }

  return diagnostics;
}
