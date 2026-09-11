/**
 * Preview webview entry. Receives label source (ZPL or EPL) + render options
 * from the extension host, parses it locally, draws the result on a canvas,
 * and optionally exports PNG or PDF bytes back to the host.
 */

import { PDFDocument } from 'pdf-lib';
import { drawPage } from '../renderer/draw';
import { RenderResult } from '../renderer/ir';
import { LabelFormatId } from '../core/formats';
import { parseLabel } from '../core/pipeline';
import { BwipBarcodeRenderer } from './barcodeAdapter';

declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  setState(state: unknown): void;
  getState<T>(): T | undefined;
};

interface RenderMessage {
  type: 'render';
  source: string;
  /** Printer language of the document; detected from the text when absent. */
  format?: LabelFormatId;
  options: {
    dpmm: number;
    widthInches: number;
    heightInches: number;
    scale: number;
  };
  pageIndex: number;
}

interface ExportMessage {
  type: 'export';
  format: 'png' | 'pdf';
  /** Printer language of the document being exported. */
  labelFormat?: LabelFormatId;
  requestId: string;
  source: string;
  options: {
    dpmm: number;
    widthInches: number;
    heightInches: number;
  };
}

type IncomingMessage = RenderMessage | ExportMessage;

// Install a global error handler as early as possible so anything that goes
// wrong at load time is surfaced in the webview (and reported to the host).
let vscodeApi: ReturnType<typeof acquireVsCodeApi> | undefined;
try {
  vscodeApi = acquireVsCodeApi();
} catch (err) {
  // acquireVsCodeApi can only be called once; if it has been called already
  // (e.g. by a reloaded bundle), ignore.
  // eslint-disable-next-line no-console
  console.error('acquireVsCodeApi failed', err);
}

function postToHost(msg: unknown): void {
  try {
    vscodeApi?.postMessage(msg);
  } catch {
    // ignore
  }
}

function showBootError(title: string, detail: string): void {
  const boot = document.getElementById('boot');
  const status = document.getElementById('status');
  if (boot) {
    boot.innerHTML = '';
    const h = document.createElement('div');
    h.className = 'err';
    h.textContent = title;
    const pre = document.createElement('pre');
    pre.className = 'err';
    pre.textContent = detail;
    boot.appendChild(h);
    boot.appendChild(pre);
  }
  if (status) {
    status.textContent = title;
  }
  postToHost({ type: 'log', level: 'error', message: title, detail });
}

window.addEventListener('error', (ev) => {
  showBootError(
    'Uncaught error in preview webview',
    `${ev.message}\nat ${ev.filename}:${ev.lineno}:${ev.colno}\n${ev.error?.stack ?? ''}`,
  );
});
window.addEventListener('unhandledrejection', (ev) => {
  const reason =
    ev.reason instanceof Error ? `${ev.reason.message}\n${ev.reason.stack ?? ''}` : String(ev.reason);
  showBootError('Unhandled promise rejection in preview webview', reason);
});

const canvas = document.getElementById('label') as HTMLCanvasElement | null;
const status = document.getElementById('status') as HTMLElement | null;
const pageLabel = document.getElementById('page-indicator') as HTMLElement | null;
const boot = document.getElementById('boot') as HTMLElement | null;

if (!canvas || !status || !pageLabel) {
  showBootError(
    'Preview DOM not ready',
    'Required elements #label / #status / #page-indicator not found.',
  );
}

let barcodes: BwipBarcodeRenderer | undefined;
try {
  barcodes = new BwipBarcodeRenderer();
} catch (err) {
  showBootError(
    'Failed to initialize barcode renderer',
    err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err),
  );
}

let lastResult: RenderResult | undefined;
let lastScale = 2;
let currentPage = 0;

window.addEventListener('message', (ev: MessageEvent<IncomingMessage>) => {
  const msg = ev.data;
  if (!msg || typeof msg.type !== 'string') {
    return;
  }
  if (msg.type === 'render') {
    renderDocument(msg);
  } else if (msg.type === 'export') {
    void handleExport(msg);
  }
});

document.querySelectorAll<HTMLButtonElement>('button[data-cmd]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const cmd = btn.dataset.cmd;
    if (cmd === 'next') {
      if (lastResult && currentPage < lastResult.pages.length - 1) {
        currentPage += 1;
        paint();
      }
    } else if (cmd === 'prev') {
      if (currentPage > 0) {
        currentPage -= 1;
        paint();
      }
    } else if (cmd === 'refresh') {
      postToHost({ type: 'refresh-request' });
    } else if (cmd === 'zoom-in') {
      lastScale = Math.min(6, lastScale * 1.25);
      paint();
    } else if (cmd === 'zoom-out') {
      lastScale = Math.max(0.25, lastScale / 1.25);
      paint();
    } else if (cmd === 'zoom-reset') {
      lastScale = 2;
      paint();
    }
  });
});

function renderDocument(msg: RenderMessage): void {
  if (!canvas || !barcodes) {
    return;
  }
  try {
    lastResult = parseLabel(msg.source, {
      format: msg.format,
      dpmm: msg.options.dpmm,
      widthInches: msg.options.widthInches,
      heightInches: msg.options.heightInches,
    });
    currentPage = Math.min(
      Math.max(0, msg.pageIndex),
      Math.max(0, lastResult.pages.length - 1),
    );
    lastScale = msg.options.scale;
    paint();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    showBootError('Render failed', message);
  }
}

function paint(): void {
  if (!canvas || !status || !pageLabel || !barcodes || !lastResult) {
    return;
  }
  const page = lastResult.pages[currentPage];
  if (!page) {
    canvas.style.display = 'none';
    if (boot) {
      boot.style.display = '';
      boot.textContent =
        'No renderable labels found. A ZPL format runs from ^XA to ^XZ; an EPL format ends with P.';
    }
    status.textContent = 'no labels';
    pageLabel.textContent = '0 / 0';
    return;
  }
  if (boot) {
    boot.style.display = 'none';
  }
  canvas.style.display = '';
  const scale = lastScale;
  canvas.width = Math.max(1, Math.round(page.width * scale));
  canvas.height = Math.max(1, Math.round(page.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    showBootError('Canvas 2D context unavailable', 'ctx is null');
    return;
  }
  try {
    drawPage(ctx, page, barcodes, { scale });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    showBootError('Draw failed', message);
    return;
  }
  pageLabel.textContent = `${currentPage + 1} / ${lastResult.pages.length}`;
  status.textContent = lastResult.warnings.length
    ? `${lastResult.warnings.length} warning${lastResult.warnings.length === 1 ? '' : 's'}: ${lastResult.warnings[0]}`
    : `${page.ops.length} op${page.ops.length === 1 ? '' : 's'}  @  ${page.width}×${page.height} dots  ·  scale ${scale.toFixed(2)}x`;
  vscodeApi?.setState({ page: currentPage, scale });
}

async function handleExport(msg: ExportMessage): Promise<void> {
  if (!barcodes) {
    postToHost({
      type: 'export-error',
      requestId: msg.requestId,
      error: 'Barcode renderer not initialized.',
    });
    return;
  }
  try {
    const result = parseLabel(msg.source, {
      format: msg.labelFormat,
      dpmm: msg.options.dpmm,
      widthInches: msg.options.widthInches,
      heightInches: msg.options.heightInches,
    });
    if (result.pages.length === 0) {
      throw new Error('No labels found in document.');
    }
    const data =
      msg.format === 'png'
        ? await exportPng(result, barcodes)
        : await exportPdf(result, barcodes);
    postToHost({
      type: 'export-result',
      requestId: msg.requestId,
      data,
      mime: msg.format === 'pdf' ? 'application/pdf' : 'image/png',
    });
  } catch (err) {
    postToHost({
      type: 'export-error',
      requestId: msg.requestId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function exportPng(
  result: RenderResult,
  barcodes: BwipBarcodeRenderer,
): Promise<number[]> {
  const page = result.pages[0];
  const off = document.createElement('canvas');
  off.width = page.width;
  off.height = page.height;
  const ctx = off.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to obtain 2D context for export.');
  }
  drawPage(ctx, page, barcodes, { scale: 1 });
  const blob: Blob = await new Promise((resolve, reject) => {
    off.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('toBlob returned null'))),
      'image/png',
    );
  });
  const buffer = await blob.arrayBuffer();
  return Array.from(new Uint8Array(buffer));
}

async function exportPdf(
  result: RenderResult,
  barcodes: BwipBarcodeRenderer,
): Promise<number[]> {
  const pdf = await PDFDocument.create();
  for (const page of result.pages) {
    const off = document.createElement('canvas');
    off.width = page.width;
    off.height = page.height;
    const ctx = off.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to obtain 2D context for PDF page.');
    }
    drawPage(ctx, page, barcodes, { scale: 1 });
    const pngBytes = await new Promise<ArrayBuffer>((resolve, reject) => {
      off.toBlob(
        (b) =>
          b
            ? b.arrayBuffer().then(resolve, reject)
            : reject(new Error('toBlob returned null')),
        'image/png',
      );
    });
    const png = await pdf.embedPng(new Uint8Array(pngBytes));
    const widthPt = (page.width / result.dpmm) * (72 / 25.4);
    const heightPt = (page.height / result.dpmm) * (72 / 25.4);
    const pdfPage = pdf.addPage([widthPt, heightPt]);
    pdfPage.drawImage(png, { x: 0, y: 0, width: widthPt, height: heightPt });
  }
  const bytes = await pdf.save();
  return Array.from(bytes);
}

// Signal readiness to the extension host after the script has fully parsed
// and event handlers are wired up.
postToHost({ type: 'ready' });
