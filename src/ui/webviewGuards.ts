import { randomBytes } from 'crypto';

/**
 * The host side of the webview trust boundary, kept free of `vscode` so unit
 * tests can cover it. A webview is treated like any other untrusted input: its
 * CSP nonce is unguessable, and every message it posts is checked for shape
 * before the host acts on it.
 */

/** Cryptographically random nonce so the webview CSP allows exactly the scripts the host wrote. */
export function generateNonce(): string {
  return randomBytes(16).toString('base64');
}

/**
 * The only host commands the preview toolbar may run. A prefix check
 * (`labelStudio.*`) would also let the webview reach Deploy, which writes
 * files and opens sockets.
 */
export const PREVIEW_COMMANDS: ReadonlySet<string> = new Set([
  'labelStudio.exportPng',
  'labelStudio.exportPdf',
  'labelStudio.exportSvg',
  'labelStudio.showActions',
  'labelStudio.refreshPreview',
]);

export function isAllowedPreviewCommand(command: unknown): command is string {
  return typeof command === 'string' && PREVIEW_COMMANDS.has(command);
}

export type PreviewMessage =
  | { type: 'ready' }
  | { type: 'refresh-request' }
  | { type: 'view-state'; page: number; scale: number }
  | { type: 'log'; level: string; message: string; detail?: string }
  | { type: 'run-command'; command: string }
  | { type: 'export-result'; requestId: string; data: number[] }
  | { type: 'export-error'; requestId: string; error: string };

export type StudioMessage =
  | { type: 'ready' }
  | { type: 'insert'; snippet: string }
  | { type: 'copy'; snippet: string }
  | { type: 'export-png'; data: number[]; name: string }
  | { type: 'error'; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

/** A byte array as `Array.from(new Uint8Array(...))` produces it. */
export function isByteArray(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.every((b) => typeof b === 'number' && Number.isInteger(b) && b >= 0 && b <= 255)
  );
}

/**
 * Validates a message from the preview webview. Returns `undefined` for an
 * unknown type, a malformed payload, or a `run-command` outside
 * {@link PREVIEW_COMMANDS}.
 */
export function parsePreviewMessage(raw: unknown): PreviewMessage | undefined {
  if (!isRecord(raw) || typeof raw.type !== 'string') {
    return undefined;
  }
  switch (raw.type) {
    case 'ready':
    case 'refresh-request':
      return { type: raw.type };
    case 'view-state':
      // Which label is showing and how far it is zoomed, so the host can send
      // them back on the next render instead of snapping to label 1.
      return typeof raw.page === 'number' &&
        Number.isInteger(raw.page) &&
        raw.page >= 0 &&
        typeof raw.scale === 'number' &&
        Number.isFinite(raw.scale) &&
        raw.scale > 0 &&
        raw.scale <= 64
        ? { type: 'view-state', page: raw.page, scale: raw.scale }
        : undefined;
    case 'log':
      if (!optionalString(raw.level) || !optionalString(raw.message) || !optionalString(raw.detail)) {
        return undefined;
      }
      return {
        type: 'log',
        level: raw.level ?? 'info',
        message: raw.message ?? '',
        ...(raw.detail !== undefined ? { detail: raw.detail } : {}),
      };
    case 'run-command':
      return isAllowedPreviewCommand(raw.command)
        ? { type: 'run-command', command: raw.command }
        : undefined;
    case 'export-result':
      return typeof raw.requestId === 'string' && isByteArray(raw.data)
        ? { type: 'export-result', requestId: raw.requestId, data: raw.data }
        : undefined;
    case 'export-error':
      return typeof raw.requestId === 'string' && optionalString(raw.error)
        ? {
            type: 'export-error',
            requestId: raw.requestId,
            error: raw.error ?? 'Unknown export error.',
          }
        : undefined;
    default:
      return undefined;
  }
}

/** Validates a message from the Barcode Studio webview; `undefined` when it is not one the host handles. */
export function parseStudioMessage(raw: unknown): StudioMessage | undefined {
  if (!isRecord(raw) || typeof raw.type !== 'string') {
    return undefined;
  }
  switch (raw.type) {
    case 'ready':
      return { type: 'ready' };
    case 'insert':
    case 'copy':
      return typeof raw.snippet === 'string'
        ? { type: raw.type, snippet: raw.snippet }
        : undefined;
    case 'export-png':
      return isByteArray(raw.data) && optionalString(raw.name)
        ? { type: 'export-png', data: raw.data, name: raw.name ?? 'barcode.png' }
        : undefined;
    case 'error':
      return optionalString(raw.message)
        ? { type: 'error', message: raw.message ?? 'Barcode studio error.' }
        : undefined;
    default:
      return undefined;
  }
}
