/**
 * Validation entry point: syntax checks for the document's own language plus
 * the format-neutral lint rules, merged into one diagnostic list.
 */

import { LabelDiagnostic } from './diagnostics';
import { LabelFormatId, detectFormat } from './formats';
import { parseLabel } from './pipeline';
import { validateZpl } from '../validation';
import { validateEpl } from '../formats/epl/validation';
import { LintOptions, lintLabel } from '../analysis/lint';

export interface ValidateLabelOptions {
  format?: LabelFormatId;
  fileName?: string;
  dpmm?: number;
  widthInches?: number;
  heightInches?: number;
  /** Pass `false` to run syntax checks only. */
  lint?: LintOptions | false;
}

/** Syntax-only validation for a single format. */
export function validateSyntax(
  source: string,
  format: LabelFormatId,
): LabelDiagnostic[] {
  return format === 'epl' ? validateEpl(source) : validateZpl(source);
}

export function validateLabelSource(
  source: string,
  options: ValidateLabelOptions = {},
): LabelDiagnostic[] {
  const format = options.format ?? detectFormat(source, options.fileName);
  const diagnostics = [...validateSyntax(source, format)];

  if (options.lint !== false) {
    const parsed = parseLabel(source, {
      format,
      dpmm: options.dpmm,
      widthInches: options.widthInches,
      heightInches: options.heightInches,
    });
    diagnostics.push(...lintLabel(parsed, source, options.lint ?? {}));
  }

  return diagnostics.sort((a, b) => a.start - b.start);
}
