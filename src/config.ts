/**
 * Settings access.
 *
 * The extension's settings moved from `zplViewer.*` to `labelStudio.*` when it
 * grew past ZPL. Reads fall back to the old key when a user has one set, so
 * existing workspaces keep working without touching their settings.json.
 */

import * as vscode from 'vscode';
import { LabelFormatId, detectFormat, isLabelFormatId } from './core/formats';
import { Density, parseDensity } from './core/units';
import { PrinterProfile, normalizePrinters } from './deploy/printers';

export const CONFIG_SECTION = 'labelStudio';
export const LEGACY_CONFIG_SECTION = 'zplViewer';

function hasExplicitValue<T>(
  inspected: ReturnType<vscode.WorkspaceConfiguration['inspect']>,
): boolean {
  if (!inspected) {
    return false;
  }
  const value = inspected as {
    globalValue?: T;
    workspaceValue?: T;
    workspaceFolderValue?: T;
  };
  return (
    value.workspaceFolderValue !== undefined ||
    value.workspaceValue !== undefined ||
    value.globalValue !== undefined
  );
}

/**
 * Reads `labelStudio.<key>`, honouring an explicitly-set legacy
 * `zplViewer.<key>` when the new key has never been set.
 */
export function getSetting<T>(key: string, fallback: T): T {
  const config = vscode.workspace.getConfiguration();
  const modernKey = `${CONFIG_SECTION}.${key}`;
  if (hasExplicitValue<T>(config.inspect<T>(modernKey))) {
    return config.get<T>(modernKey, fallback);
  }
  const legacyKey = `${LEGACY_CONFIG_SECTION}.${key}`;
  if (hasExplicitValue<T>(config.inspect<T>(legacyKey))) {
    return config.get<T>(legacyKey, fallback);
  }
  return config.get<T>(modernKey, fallback);
}

/** True when a configuration change touches either namespace. */
export function affectsLabelStudio(
  event: vscode.ConfigurationChangeEvent,
  suffix = '',
): boolean {
  const modern = suffix ? `${CONFIG_SECTION}.${suffix}` : CONFIG_SECTION;
  const legacy = suffix
    ? `${LEGACY_CONFIG_SECTION}.${suffix}`
    : LEGACY_CONFIG_SECTION;
  return event.affectsConfiguration(modern) || event.affectsConfiguration(legacy);
}

export interface RenderConfig {
  dpmm: Density;
  widthInches: number;
  heightInches: number;
  scale: number;
}

export function getRenderConfig(): RenderConfig {
  return {
    dpmm: parseDensity(getSetting<string>('renderer.density', '8dpmm')),
    widthInches: getSetting<number>('label.widthInches', 4),
    heightInches: getSetting<number>('label.heightInches', 6),
    scale: getSetting<number>('preview.initialZoom', 2),
  };
}

export interface FormatConfig {
  uppercaseCommands: boolean;
  oneCommandPerLine: boolean;
}

export function getFormatConfig(): FormatConfig {
  return {
    uppercaseCommands: getSetting<boolean>('format.uppercaseCommands', true),
    oneCommandPerLine: getSetting<boolean>('format.oneCommandPerLine', true),
  };
}

export interface ValidationConfig {
  enable: boolean;
  barcodeData: boolean;
  bounds: boolean;
  scannability: boolean;
}

export function getValidationConfig(): ValidationConfig {
  return {
    enable: getSetting<boolean>('validation.enable', true),
    barcodeData: getSetting<boolean>('validation.barcodeData', true),
    bounds: getSetting<boolean>('validation.bounds', true),
    scannability: getSetting<boolean>('validation.scannability', true),
  };
}

export function getPreviewConfig(): {
  autoRefresh: boolean;
  autoRefreshDelay: number;
} {
  return {
    autoRefresh: getSetting<boolean>('preview.autoRefresh', true),
    autoRefreshDelay: getSetting<number>('preview.autoRefreshDelay', 400),
  };
}

export function getDefaultFormat(): LabelFormatId | 'auto' {
  const value = getSetting<string>('defaultFormat', 'auto');
  return value === 'auto' || !isLabelFormatId(value) ? 'auto' : value;
}

export function getPrinters(): PrinterProfile[] {
  return normalizePrinters(getSetting<unknown[]>('printers', []));
}

export function getMergeConfig(): { maxRows: number } {
  return { maxRows: getSetting<number>('merge.maxRows', 500) };
}

export function getImportConfig(): {
  threshold: number;
  dither: 'none' | 'floyd-steinberg';
  maxWidthDots: number;
  invert: boolean;
  trim: boolean;
  rotate: 0 | 90 | 180 | 270;
} {
  const dither = getSetting<string>('import.dither', 'none');
  const rotate = getSetting<number>('import.rotate', 0);
  return {
    threshold: getSetting<number>('import.threshold', 128),
    dither: dither === 'floyd-steinberg' ? 'floyd-steinberg' : 'none',
    maxWidthDots: getSetting<number>('import.maxWidthDots', 600),
    invert: getSetting<boolean>('import.invert', false),
    trim: getSetting<boolean>('import.trim', false),
    rotate: rotate === 90 || rotate === 180 || rotate === 270 ? rotate : 0,
  };
}

export function getDeployConfig(): {
  confirmBeforeSend: boolean;
  timeoutMs: number;
} {
  return {
    confirmBeforeSend: getSetting<boolean>('deploy.confirmBeforeSend', true),
    timeoutMs: getSetting<number>('deploy.timeoutMs', 10000),
  };
}

/**
 * Format of a document: its language id when it is one we contribute,
 * otherwise the configured default, otherwise sniffed from the text.
 */
export function formatOfDocument(
  document: Pick<vscode.TextDocument, 'languageId' | 'getText' | 'fileName'>,
): LabelFormatId {
  if (isLabelFormatId(document.languageId)) {
    return document.languageId;
  }
  const configured = getDefaultFormat();
  return detectFormat(
    document.getText(),
    document.fileName,
    configured === 'auto' ? 'zpl' : configured,
  );
}
