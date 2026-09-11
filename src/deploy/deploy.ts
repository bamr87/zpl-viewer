/**
 * Deployment orchestration: take a label document, make it speak the target
 * printer's language, and hand it to a transport.
 */

import { LabelFormatId, detectFormat } from '../core/formats';
import { convertLabel } from '../core/pipeline';
import { PrinterProfile, describePrinter, validatePrinter } from './printers';
import { SendOptions, SendResult, sendToPrinter } from './transports';

export interface DeployRequest {
  profile: PrinterProfile;
  source: string;
  /** Source format; detected from the text when omitted. */
  format?: LabelFormatId;
  fileName?: string;
  /** Build the payload and report on it without opening a connection. */
  dryRun?: boolean;
  send?: SendOptions;
}

export interface DeployOutcome {
  ok: boolean;
  /** The exact bytes that were (or would be) sent, as text. */
  payload: string;
  target: string;
  converted: boolean;
  warnings: string[];
  result?: SendResult;
  error?: string;
}

/**
 * Prepares the payload for a printer: converts between printer languages when
 * the document and the target disagree, which is what makes one template
 * deployable to a mixed fleet.
 */
export function buildDeployPayload(request: DeployRequest): {
  payload: string;
  converted: boolean;
  warnings: string[];
} {
  const sourceFormat =
    request.format ?? detectFormat(request.source, request.fileName);
  if (sourceFormat === request.profile.format) {
    return { payload: request.source, converted: false, warnings: [] };
  }
  const converted = convertLabel(request.source, request.profile.format, {
    format: sourceFormat,
    dpmm: request.profile.dpmm,
    widthInches: request.profile.widthInches,
    heightInches: request.profile.heightInches,
  });
  return {
    payload: converted.text,
    converted: true,
    warnings: [
      `Converted ${sourceFormat.toUpperCase()} to ${request.profile.format.toUpperCase()} for ${request.profile.name}.`,
      ...converted.warnings,
    ],
  };
}

export async function deployLabel(
  request: DeployRequest,
): Promise<DeployOutcome> {
  const problems = validatePrinter(request.profile);
  const { payload, converted, warnings } = buildDeployPayload(request);
  const target = describePrinter(request.profile);

  if (problems.length > 0) {
    return {
      ok: false,
      payload,
      target,
      converted,
      warnings,
      error: problems.join(' '),
    };
  }

  if (request.dryRun) {
    return {
      ok: true,
      payload,
      target,
      converted,
      warnings: [...warnings, 'Dry run: nothing was sent to the printer.'],
    };
  }

  try {
    const result = await sendToPrinter(
      request.profile,
      payload,
      request.send ?? {},
    );
    return { ok: true, payload, target, converted, warnings, result };
  } catch (err) {
    return {
      ok: false,
      payload,
      target,
      converted,
      warnings,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
