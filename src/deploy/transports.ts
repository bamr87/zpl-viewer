/**
 * Transports that carry a label stream to a printer.
 *
 * Note this is the one place in the extension that opens a socket. Rendering,
 * validation and export stay entirely local; deployment talks to the printer
 * the user explicitly selected, on the port they configured, and logs exactly
 * what it sent.
 */

import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import { PrinterProfile } from './printers';

export interface SendOptions {
  /** Abandon the connection after this long (default 10s). */
  timeoutMs?: number;
  /** Wait this long for printer chatter after sending (default 250ms). */
  responseWaitMs?: number;
}

export interface SendResult {
  target: string;
  bytesSent: number;
  durationMs: number;
  /** Anything the printer sent back (status responses, error codes). */
  response?: string;
}

/**
 * Printer languages are byte streams, not Unicode text: `^GF`/`GW` payloads
 * and code-page characters must reach the printer exactly as written, so the
 * document is encoded one byte per character.
 */
export function encodeLabelStream(payload: string): Buffer {
  return Buffer.from(payload, 'latin1');
}

async function sendTcp(
  profile: PrinterProfile,
  data: Buffer,
  options: SendOptions,
): Promise<SendResult> {
  const timeoutMs = options.timeoutMs ?? 10000;
  const responseWaitMs = options.responseWaitMs ?? 250;
  const host = profile.host ?? '';
  const target = `${host}:${profile.port}`;
  const started = Date.now();

  return new Promise<SendResult>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let settled = false;
    const socket = net.createConnection({ host, port: profile.port });
    socket.setTimeout(timeoutMs);

    const finish = (error?: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      if (error) {
        reject(error);
        return;
      }
      resolve({
        target,
        bytesSent: data.length,
        durationMs: Date.now() - started,
        response: chunks.length
          ? Buffer.concat(chunks).toString('latin1').trim()
          : undefined,
      });
    };

    socket.on('connect', () => {
      socket.write(data, () => {
        // Give the printer a moment to answer before closing: status queries
        // such as `~HS` reply on the same connection.
        setTimeout(() => socket.end(), responseWaitMs);
      });
    });
    socket.on('data', (chunk: Buffer) => chunks.push(chunk));
    socket.on('timeout', () =>
      finish(new Error(`Timed out after ${timeoutMs}ms talking to ${target}.`)),
    );
    socket.on('error', (err: Error) =>
      finish(new Error(`${target}: ${err.message}`)),
    );
    socket.on('close', () => finish());
  });
}

async function sendFile(
  profile: PrinterProfile,
  data: Buffer,
): Promise<SendResult> {
  const target = profile.path ?? '';
  const started = Date.now();
  await fs.promises.writeFile(target, data, {
    flag: profile.append ? 'a' : 'w',
  });
  return {
    target,
    bytesSent: data.length,
    durationMs: Date.now() - started,
  };
}

/** Name of the spool file a directory deploy writes. */
export function spoolFileName(profile: PrinterProfile, when = new Date()): string {
  const stamp = when.toISOString().replace(/[:.]/g, '-');
  const extension = profile.format === 'epl' ? 'epl' : 'zpl';
  return `label-${stamp}.${extension}`;
}

async function sendDirectory(
  profile: PrinterProfile,
  data: Buffer,
): Promise<SendResult> {
  const directory = profile.path ?? '';
  const target = path.join(directory, spoolFileName(profile));
  const started = Date.now();
  await fs.promises.mkdir(directory, { recursive: true });
  await fs.promises.writeFile(target, data);
  return {
    target,
    bytesSent: data.length,
    durationMs: Date.now() - started,
  };
}

export async function sendToPrinter(
  profile: PrinterProfile,
  payload: string,
  options: SendOptions = {},
): Promise<SendResult> {
  const data = encodeLabelStream(payload);
  switch (profile.transport) {
    case 'file':
      return sendFile(profile, data);
    case 'directory':
      return sendDirectory(profile, data);
    default:
      return sendTcp(profile, data, options);
  }
}
