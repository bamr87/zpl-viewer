/**
 * Printer profiles — the "where does this label go" half of deployment.
 *
 * A profile is plain settings data (`labelStudio.printers`), so a team can
 * commit its printer list to the repository and everyone deploys to the same
 * targets.
 */

import { LabelFormatId, isLabelFormatId } from '../core/formats';
import { Density, parseDensity } from '../core/units';

export type PrinterTransport = 'tcp' | 'file' | 'directory';

export interface PrinterProfile {
  name: string;
  transport: PrinterTransport;
  /** Hostname or IP for `tcp`. */
  host?: string;
  /** Port for `tcp`; raw printing is port 9100 on virtually every printer. */
  port: number;
  /** Target path for `file` (device node, share) or `directory` (spool folder). */
  path?: string;
  /** Printer language the target expects. */
  format: LabelFormatId;
  dpmm: Density;
  widthInches?: number;
  heightInches?: number;
  description?: string;
  /** Append to the target file instead of replacing it. */
  append?: boolean;
}

export const DEFAULT_RAW_PORT = 9100;

/** Builds a profile from untyped settings data, filling in sane defaults. */
export function normalizePrinter(raw: unknown): PrinterProfile | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }
  const value = raw as Record<string, unknown>;
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  if (!name) {
    return undefined;
  }
  const transport: PrinterTransport =
    value.transport === 'file' || value.transport === 'directory'
      ? value.transport
      : 'tcp';
  const format =
    typeof value.format === 'string' && isLabelFormatId(value.format)
      ? value.format
      : 'zpl';
  const port =
    typeof value.port === 'number' && Number.isFinite(value.port)
      ? Math.trunc(value.port)
      : DEFAULT_RAW_PORT;

  return {
    name,
    transport,
    host: typeof value.host === 'string' ? value.host.trim() : undefined,
    port,
    path: typeof value.path === 'string' ? value.path : undefined,
    format,
    dpmm: parseDensity(
      typeof value.dpmm === 'number' || typeof value.dpmm === 'string'
        ? value.dpmm
        : undefined,
    ),
    widthInches:
      typeof value.widthInches === 'number' ? value.widthInches : undefined,
    heightInches:
      typeof value.heightInches === 'number' ? value.heightInches : undefined,
    description:
      typeof value.description === 'string' ? value.description : undefined,
    append: value.append === true,
  };
}

export function normalizePrinters(raw: unknown): PrinterProfile[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const profiles: PrinterProfile[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const profile = normalizePrinter(entry);
    if (!profile || seen.has(profile.name)) {
      continue;
    }
    seen.add(profile.name);
    profiles.push(profile);
  }
  return profiles;
}

/** Human-readable problems that would stop a deploy; empty means ready. */
export function validatePrinter(profile: PrinterProfile): string[] {
  const problems: string[] = [];
  if (profile.transport === 'tcp') {
    if (!profile.host) {
      problems.push('No host set; a TCP printer needs a hostname or IP address.');
    }
    if (profile.port <= 0 || profile.port > 65535) {
      problems.push(`Port ${profile.port} is out of range.`);
    }
  } else if (!profile.path) {
    problems.push(
      profile.transport === 'file'
        ? 'No path set; point `path` at the printer device or share.'
        : 'No path set; point `path` at the spool directory.',
    );
  }
  return problems;
}

/** One-line summary used in pickers, tree views and the output channel. */
export function describePrinter(profile: PrinterProfile): string {
  const target =
    profile.transport === 'tcp'
      ? `${profile.host ?? '(no host)'}:${profile.port}`
      : (profile.path ?? '(no path)');
  return `${profile.transport} → ${target} · ${profile.format.toUpperCase()} · ${profile.dpmm} dpmm`;
}
