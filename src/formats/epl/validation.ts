/**
 * EPL2 validator. Catches the mistakes that make a printer quietly produce a
 * blank or garbled label: unknown verbs, short parameter lists, missing data
 * strings, a format that never clears the buffer, and one that never prints.
 */

import { LabelDiagnostic } from '../../core/diagnostics';
import { findEplCommand } from './commands';
import { tokenizeEpl } from './tokenizer';

const DATA_COMMANDS = new Set(['A', 'B', 'b']);

export function validateEpl(text: string): LabelDiagnostic[] {
  const diagnostics: LabelDiagnostic[] = [];
  const tokens = tokenizeEpl(text);

  let sawClear = false;
  let sawPrint = false;
  let sawField = false;
  let firstFieldOffset: number | undefined;

  for (const token of tokens) {
    const command = findEplCommand(token.name);
    if (!command) {
      diagnostics.push({
        start: token.start,
        end: token.start + token.name.length,
        message: `Unknown EPL command \`${token.name}\`.`,
        severity: 'warning',
        rule: 'epl.unknown-command',
      });
      continue;
    }

    if (token.name === 'N') {
      sawClear = true;
    } else if (token.name === 'P') {
      sawPrint = true;
    }

    if (DATA_COMMANDS.has(token.name)) {
      sawField = true;
      if (firstFieldOffset === undefined) {
        firstFieldOffset = token.start;
      }
      if (token.data === undefined) {
        diagnostics.push({
          start: token.start,
          end: token.end,
          message: `\`${token.name}\` needs quoted data, e.g. \`"TEXT"\`.`,
          severity: 'warning',
          rule: 'epl.missing-data',
        });
      }
    } else if (token.name === 'X' || token.name === 'LO' || token.name === 'LE') {
      sawField = true;
      if (firstFieldOffset === undefined) {
        firstFieldOffset = token.start;
      }
    }

    const quotes = (token.raw.match(/(?<!\\)"/g) ?? []).length;
    if (quotes % 2 !== 0) {
      diagnostics.push({
        start: token.start,
        end: token.end,
        message: 'Unterminated quoted string.',
        severity: 'warning',
        rule: 'epl.unterminated-string',
      });
    }

    const required = (command.parameters ?? []).filter((p) => !p.optional).length;
    if (required > 0 && token.args.length > 0 && token.args.length < required) {
      diagnostics.push({
        start: token.start,
        end: token.end,
        message: `\`${token.name}\` expects ${required} parameter(s), got ${token.args.length}.`,
        severity: 'information',
        rule: 'epl.parameter-count',
      });
    }
  }

  if (sawField && !sawClear) {
    diagnostics.push({
      start: firstFieldOffset ?? 0,
      end: (firstFieldOffset ?? 0) + 1,
      message:
        'Format does not start with `N`; the previous label stays in the image buffer and prints again.',
      severity: 'warning',
      rule: 'epl.missing-clear',
    });
  }
  if (sawField && !sawPrint) {
    diagnostics.push({
      start: Math.max(0, text.length - 1),
      end: text.length,
      message: 'Format has no `P` command, so the printer never prints it.',
      severity: 'warning',
      rule: 'epl.missing-print',
    });
  }

  return diagnostics;
}
