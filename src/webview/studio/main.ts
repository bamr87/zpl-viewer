/**
 * Barcode studio webview.
 *
 * Pick a symbology, type the data, and see the encoded symbol, the rules it
 * has to satisfy, and the exact ZPL or EPL field that produces it. The same
 * catalog, validator, encoder and emitters the rest of the extension uses run
 * here, so what the studio shows is what the label will print.
 */

import { BarcodeOp, BarcodeSymbology } from '../../renderer/ir';
import { SYMBOLOGIES, describeSymbology, findSymbology } from '../../barcode/symbologies';
import { validateBarcodeData } from '../../barcode/validate';
import { emitZplPage } from '../../emit/zpl';
import { emitEplPage } from '../../emit/epl';
import { LabelPage } from '../../renderer/ir';
import { BwipBarcodeRenderer } from '../barcodeAdapter';

declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  setState(state: unknown): void;
  getState<T>(): T | undefined;
};

let vscodeApi: ReturnType<typeof acquireVsCodeApi> | undefined;
try {
  vscodeApi = acquireVsCodeApi();
} catch {
  vscodeApi = undefined;
}

function post(msg: unknown): void {
  try {
    vscodeApi?.postMessage(msg);
  } catch {
    // The studio still works as a preview without a host connection.
  }
}

const el = <T extends HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const symbologySelect = el<HTMLSelectElement>('symbology');
const dataInput = el<HTMLTextAreaElement>('data');
const moduleWidthInput = el<HTMLInputElement>('moduleWidth');
const heightInput = el<HTMLInputElement>('height');
const magnificationInput = el<HTMLInputElement>('magnification');
const eccSelect = el<HTMLSelectElement>('ecc');
const hriSelect = el<HTMLSelectElement>('hri');
const targetSelect = el<HTMLSelectElement>('target');
const docBox = el<HTMLDivElement>('doc');
const issuesBox = el<HTMLDivElement>('issues');
const snippetBox = el<HTMLPreElement>('snippet');
const canvas = el<HTMLCanvasElement>('barcode');

const renderer = new BwipBarcodeRenderer();

for (const spec of SYMBOLOGIES) {
  const option = document.createElement('option');
  option.value = spec.id;
  option.textContent = `${spec.label} (${spec.kind === '2d' ? '2-D' : spec.kind})`;
  symbologySelect.appendChild(option);
}
symbologySelect.value = 'code128';

function currentOp(): BarcodeOp {
  const symbology = symbologySelect.value as BarcodeSymbology;
  return {
    type: 'barcode',
    symbology,
    data: dataInput.value,
    moduleWidth: Math.max(1, Number(moduleWidthInput.value) || 2),
    ratio: 3,
    height: Math.max(1, Number(heightInput.value) || 80),
    interpretation: hriSelect.value === 'yes',
    interpretationAbove: false,
    magnification: Math.max(1, Number(magnificationInput.value) || 5),
    errorCorrection: eccSelect.value,
    x: 50,
    y: 50,
    rotation: 'N',
    reverse: false,
  };
}

function pageFor(op: BarcodeOp): LabelPage {
  return { width: 812, height: 406, ops: [op], homeX: 0, homeY: 0 };
}

function renderIssues(op: BarcodeOp): void {
  const issues = validateBarcodeData(op.symbology, op.data);
  issuesBox.innerHTML = '';
  if (issues.length === 0) {
    const ok = document.createElement('div');
    ok.className = 'ok';
    ok.textContent = 'Data encodes cleanly.';
    issuesBox.appendChild(ok);
    return;
  }
  for (const issue of issues) {
    const node = document.createElement('div');
    node.className = `issue ${issue.severity}`;
    node.textContent = `${issue.severity}: ${issue.message}`;
    issuesBox.appendChild(node);
  }
}

function renderDoc(): void {
  const spec = findSymbology(symbologySelect.value);
  docBox.textContent = spec
    ? describeSymbology(spec)
        .replace(/\*\*/g, '')
        .replace(/`/g, '')
    : '';
  const is2d = spec?.kind === '2d';
  magnificationInput.disabled = !is2d;
  eccSelect.disabled = spec?.id !== 'qrcode';
  heightInput.disabled = Boolean(is2d);
  moduleWidthInput.disabled = Boolean(is2d);
}

function renderSnippet(op: BarcodeOp): void {
  const page = pageFor(op);
  const snippet =
    targetSelect.value === 'epl'
      ? emitEplPage(page, { includeSetup: false })
      : emitZplPage(page, { includeSetup: false, multiline: true })
          .replace(/^\^XA\n/, '')
          .replace(/\n\^XZ$/, '');
  snippetBox.textContent = snippet || '—';
  return;
}

function renderPreview(op: BarcodeOp): void {
  const context = canvas.getContext('2d');
  if (!context) {
    return;
  }
  if (op.data.length === 0) {
    canvas.width = 1;
    canvas.height = 1;
    return;
  }
  try {
    const encoded = renderer.render(op) as HTMLCanvasElement;
    canvas.width = encoded.width;
    canvas.height = encoded.height;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(encoded, 0, 0);
  } catch (err) {
    canvas.width = 1;
    canvas.height = 1;
    const node = document.createElement('div');
    node.className = 'issue error';
    node.textContent = `Encoder: ${err instanceof Error ? err.message : String(err)}`;
    issuesBox.appendChild(node);
  }
}

function refresh(): void {
  const op = currentOp();
  renderDoc();
  renderIssues(op);
  renderPreview(op);
  renderSnippet(op);
  post({ type: 'state', symbology: op.symbology, data: op.data });
}

for (const control of [
  symbologySelect,
  dataInput,
  moduleWidthInput,
  heightInput,
  magnificationInput,
  eccSelect,
  hriSelect,
  targetSelect,
]) {
  control.addEventListener('input', refresh);
  control.addEventListener('change', refresh);
}

symbologySelect.addEventListener('change', () => {
  const spec = findSymbology(symbologySelect.value);
  if (spec && dataInput.value.trim() === '') {
    dataInput.value = spec.example;
  }
  refresh();
});

el<HTMLButtonElement>('insert').addEventListener('click', () => {
  post({ type: 'insert', snippet: snippetBox.textContent ?? '' });
});

el<HTMLButtonElement>('copy').addEventListener('click', () => {
  post({ type: 'copy', snippet: snippetBox.textContent ?? '' });
});

el<HTMLButtonElement>('export').addEventListener('click', () => {
  canvas.toBlob((blob) => {
    if (!blob) {
      post({ type: 'error', message: 'Nothing to export yet.' });
      return;
    }
    void blob.arrayBuffer().then((buffer) => {
      post({
        type: 'export-png',
        data: Array.from(new Uint8Array(buffer)),
        name: `${symbologySelect.value}.png`,
      });
    });
  }, 'image/png');
});

window.addEventListener('message', (event: MessageEvent<{ type: string; format?: string; data?: string }>) => {
  const msg = event.data;
  if (!msg || msg.type !== 'init') {
    return;
  }
  if (msg.format === 'epl' || msg.format === 'zpl') {
    targetSelect.value = msg.format;
  }
  if (typeof msg.data === 'string' && msg.data.length > 0) {
    dataInput.value = msg.data;
  }
  refresh();
});

dataInput.value = findSymbology('code128')?.example ?? '';
refresh();
post({ type: 'ready' });
