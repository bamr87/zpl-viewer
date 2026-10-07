/**
 * Format-dispatching pipeline: parse, format, emit and convert a label
 * document without the caller knowing which printer language it is written in.
 *
 * Everything above this module (preview, export, analysis, merge, deploy)
 * speaks in terms of {@link LabelFormatId} and the shared IR.
 */

import { RenderResult } from '../renderer/ir';
import { parseZpl } from '../renderer/parser';
import { parseEpl } from '../formats/epl/parser';
import { formatZpl } from '../formatting';
import { formatEpl } from '../formats/epl/formatting';
import { EmitResult, emitZpl } from '../emit/zpl';
import { emitEpl } from '../emit/epl';
import { LabelFormatId, detectFormat } from './formats';

export interface ParseLabelOptions {
  /** Force a format instead of detecting one. */
  format?: LabelFormatId;
  /** File name used for extension-based detection. */
  fileName?: string;
  dpmm?: number;
  widthInches?: number;
  heightInches?: number;
}

export interface ParsedLabel extends RenderResult {
  format: LabelFormatId;
}

export function parseLabel(
  source: string,
  options: ParseLabelOptions = {},
): ParsedLabel {
  const format = options.format ?? detectFormat(source, options.fileName);
  const parseOptions = {
    dpmm: options.dpmm,
    widthInches: options.widthInches,
    heightInches: options.heightInches,
  };
  const result =
    format === 'epl' ? parseEpl(source, parseOptions) : parseZpl(source, parseOptions);
  return { ...result, format };
}

export interface FormatLabelOptions {
  uppercaseCommands?: boolean;
  oneCommandPerLine?: boolean;
}

export function formatLabel(
  source: string,
  format: LabelFormatId,
  options: FormatLabelOptions = {},
): string {
  if (format === 'epl') {
    // EPL command case is significant, so only layout is normalized.
    return formatEpl(source);
  }
  return formatZpl(source, {
    uppercase: options.uppercaseCommands ?? true,
    oneCommandPerLine: options.oneCommandPerLine ?? true,
  });
}

export interface EmitLabelOptions {
  dpmm?: number;
  includeSetup?: boolean;
}

export function emitLabel(
  result: RenderResult,
  format: LabelFormatId,
  options: EmitLabelOptions = {},
): EmitResult {
  return format === 'epl'
    ? emitEpl(result, { dpmm: options.dpmm, includeSetup: options.includeSetup })
    : emitZpl(result, { includeSetup: options.includeSetup });
}

export interface ConvertResult extends EmitResult {
  from: LabelFormatId;
  to: LabelFormatId;
  pages: number;
}

/**
 * Re-expresses a label in another printer language by parsing it to the shared
 * IR and emitting from there. Conversion is lossy in one direction or the
 * other (EPL has fewer primitives, ZPL has no fixed font ladder), so every
 * approximation is reported in `warnings`.
 */
export function convertLabel(
  source: string,
  to: LabelFormatId,
  options: ParseLabelOptions = {},
): ConvertResult {
  const parsed = parseLabel(source, options);
  const emitted = emitLabel(parsed, to, {
    dpmm: options.dpmm ?? parsed.dpmm,
  });
  return {
    ...emitted,
    from: parsed.format,
    to,
    pages: parsed.pages.length,
    warnings: [...parsed.warnings, ...emitted.warnings],
  };
}
