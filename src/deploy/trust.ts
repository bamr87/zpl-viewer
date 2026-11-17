/**
 * Deploy's trust decisions, kept free of `vscode` so unit tests can cover them.
 *
 * Printer profiles are settings, and settings can come from the workspace —
 * a cloned repository's `.vscode/settings.json`. A `file` or `directory`
 * printer is a write primitive, so where a profile came from and where it
 * would write decide whether Deploy asks before it sends.
 */

import * as path from 'path';
import { PrinterProfile } from './printers';

/** Which settings layer supplied a value, most specific first. */
export type SettingOrigin = 'workspaceFolder' | 'workspace' | 'user' | 'default';

/** The parts of `WorkspaceConfiguration.inspect()` that decide the origin. */
export interface InspectedValues {
  workspaceFolderValue?: unknown;
  workspaceValue?: unknown;
  globalValue?: unknown;
}

/** The layer whose value `get()` returns: the most specific one that is set. */
export function settingOrigin(inspected: InspectedValues | undefined): SettingOrigin {
  if (!inspected) {
    return 'default';
  }
  if (inspected.workspaceFolderValue !== undefined) {
    return 'workspaceFolder';
  }
  if (inspected.workspaceValue !== undefined) {
    return 'workspace';
  }
  if (inspected.globalValue !== undefined) {
    return 'user';
  }
  return 'default';
}

export function isWorkspaceOrigin(origin: SettingOrigin): boolean {
  return origin === 'workspace' || origin === 'workspaceFolder';
}

/**
 * Whether Deploy must show its confirmation. A dry run sends nothing, so it
 * never asks. A profile the workspace defined always asks, whatever
 * `confirmBeforeSend` says. Otherwise the user's own setting decides.
 */
export function needsConfirmation(options: {
  origin: SettingOrigin;
  confirmSetting: boolean;
  dryRun: boolean;
}): boolean {
  if (options.dryRun) {
    return false;
  }
  if (isWorkspaceOrigin(options.origin)) {
    return true;
  }
  return options.confirmSetting;
}

export interface ResolvedTarget {
  /** The path the transport will write to, absolute. */
  absolutePath: string;
  /** True when that path sits inside one of the workspace folders. */
  insideWorkspace: boolean;
}

/**
 * Resolves a `file` / `directory` profile's `path`. A relative path resolves
 * against the first workspace folder rather than the process's working
 * directory. Returns `undefined` for a TCP profile or one without a path.
 */
export function resolveTargetPath(
  profile: Pick<PrinterProfile, 'transport' | 'path'>,
  workspaceFolders: readonly string[],
): ResolvedTarget | undefined {
  if (profile.transport === 'tcp' || !profile.path) {
    return undefined;
  }
  const base = workspaceFolders[0];
  const absolutePath = path.isAbsolute(profile.path)
    ? path.resolve(profile.path)
    : path.resolve(base ?? process.cwd(), profile.path);
  const insideWorkspace = workspaceFolders.some((folder) => {
    const relative = path.relative(path.resolve(folder), absolutePath);
    return (
      relative === '' ||
      (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
    );
  });
  return { absolutePath, insideWorkspace };
}

/** The text of Deploy's confirmation modal. */
export function confirmationMessage(options: {
  profile: Pick<PrinterProfile, 'name' | 'transport' | 'host' | 'port' | 'path'>;
  origin: SettingOrigin;
  labelCount: number;
  resolved?: ResolvedTarget;
}): string {
  const { profile, origin, labelCount, resolved } = options;
  const target =
    profile.transport === 'tcp'
      ? `${profile.host ?? '(no host)'}:${profile.port}`
      : (resolved?.absolutePath ?? profile.path ?? '(no path)');
  const lines = [
    `Send ${labelCount} label(s) to ${profile.name} over ${profile.transport} → ${target}?`,
  ];
  if (isWorkspaceOrigin(origin)) {
    lines.push(
      `This printer is defined by this workspace's settings, not yours. Only send if you trust this workspace.`,
    );
  }
  if (resolved && !resolved.insideWorkspace) {
    lines.push(`The ${profile.transport} target is outside this workspace.`);
  }
  return lines.join('\n\n');
}
