/**
 * Every Label Studio command.
 *
 * Commands are thin: they collect input, call into the pure modules
 * (`core/`, `data/`, `analysis/`, `importers/`, `deploy/`), and present the
 * result. Anything worth testing lives below this layer.
 */

import * as vscode from 'vscode';
import { LabelPreviewManager } from '../previewPanel';
import { LabelDiagnostics } from '../diagnostics';
import {
  ALL_FORMAT_IDS,
  LABEL_FORMATS,
  isLabelFormatId,
} from '../core/formats';
import { convertLabel, parseLabel } from '../core/pipeline';
import { validateLabelSource } from '../core/validate';
import {
  LABEL_TEMPLATES,
  fillTemplateSample,
  findTemplate,
} from '../core/templates';
import { analyzeLabel } from '../analysis/metrics';
import { renderAnalysisMarkdown } from '../analysis/report';
import { loadDataset, datasetToMarkdown } from '../data/dataset';
import { analyzeMapping, mappingToMarkdown, mergeDataset } from '../data/merge';
import { templateFields } from '../data/template';
import { importImage, bitmapToEplGraphicWrite, bitmapToZplGraphicField } from '../importers/imageToLabel';
import { importCapture } from '../importers/capture';
import { deployLabel } from '../deploy/deploy';
import { PrinterProfile, describePrinter } from '../deploy/printers';
import { SYMBOLOGIES, findSymbology } from '../barcode/symbologies';
import { validateBarcodeData } from '../barcode/validate';
import { emitZplPage } from '../emit/zpl';
import { emitEplPage } from '../emit/epl';
import { BarcodeStudioPanel } from './barcodeStudio';
import { LabelExplorer } from './labelExplorer';
import {
  CONFIG_SECTION,
  formatOfDocument,
  getDeployConfig,
  getImportConfig,
  getMergeConfig,
  getPrinters,
  getRenderConfig,
} from '../config';

export interface CommandContext {
  context: vscode.ExtensionContext;
  preview: LabelPreviewManager;
  diagnostics: LabelDiagnostics;
  explorer: LabelExplorer;
  output: vscode.OutputChannel;
}

export function registerCommands(deps: CommandContext): vscode.Disposable[] {
  const { context, preview, diagnostics, explorer, output } = deps;

  const register = (
    id: string,
    handler: (...args: unknown[]) => unknown,
  ): vscode.Disposable => vscode.commands.registerCommand(id, handler);

  const disposables: vscode.Disposable[] = [
    // ---------------------------------------------------------------- view
    register('labelStudio.preview', () => {
      const editor = requireLabelEditor();
      if (editor) {
        preview.show(editor.document, false);
      }
    }),
    register('labelStudio.previewToSide', () => {
      const editor = requireLabelEditor();
      if (editor) {
        preview.show(editor.document, true);
      }
    }),
    register('labelStudio.refreshPreview', () => preview.refreshActive()),
    register('labelStudio.exportPng', () => exportLabel(preview, 'png')),
    register('labelStudio.exportPdf', () => exportLabel(preview, 'pdf')),

    // ---------------------------------------------------------------- edit
    register('labelStudio.formatDocument', async () => {
      if (!requireLabelEditor()) {
        return;
      }
      await vscode.commands.executeCommand('editor.action.formatDocument');
    }),
    register('labelStudio.validate', () => {
      const editor = requireLabelEditor();
      if (!editor) {
        return;
      }
      diagnostics.refresh(editor.document);
      const findings = validateLabelSource(editor.document.getText(), {
        format: formatOfDocument(editor.document),
        fileName: editor.document.fileName,
      });
      void vscode.window.showInformationMessage(
        findings.length === 0
          ? 'Label is valid — no findings.'
          : `Validation complete: ${findings.length} finding(s). See the Problems panel.`,
      );
    }),
    register('labelStudio.insertTemplate', () => insertStarterSnippet()),
    register('labelStudio.newFromTemplate', (templateId?: unknown) =>
      newFromTemplate(typeof templateId === 'string' ? templateId : undefined),
    ),
    register('labelStudio.convertFormat', () => convertActiveDocument()),

    // ------------------------------------------------------------ barcodes
    register('labelStudio.openBarcodeStudio', () => {
      const editor = vscode.window.activeTextEditor;
      BarcodeStudioPanel.show(context, {
        format:
          editor && isLabelFormatId(editor.document.languageId)
            ? formatOfDocument(editor.document)
            : undefined,
        data: editor?.document.getText(editor.selection) || undefined,
      });
    }),
    register('labelStudio.insertBarcode', () => insertBarcodeField()),

    // -------------------------------------------------------------- import
    register('labelStudio.importImage', () => importImageCommand()),
    register('labelStudio.importCapture', () => importCaptureCommand()),

    // ---------------------------------------------------------------- data
    register('labelStudio.previewDataSource', (uri?: unknown) =>
      previewDataSource(uri instanceof vscode.Uri ? uri : undefined),
    ),
    register('labelStudio.mergeData', (uri?: unknown) =>
      mergeDataCommand(uri instanceof vscode.Uri ? uri : undefined),
    ),
    register('labelStudio.checkMapping', (uri?: unknown) =>
      checkMappingCommand(uri instanceof vscode.Uri ? uri : undefined),
    ),

    // ------------------------------------------------------------- analysis
    register('labelStudio.analyze', () => analyzeCommand()),

    // --------------------------------------------------------------- deploy
    register('labelStudio.deploy', (name?: unknown) =>
      deployCommand(output, typeof name === 'string' ? name : undefined, false),
    ),
    register('labelStudio.deployDryRun', (name?: unknown) =>
      deployCommand(output, typeof name === 'string' ? name : undefined, true),
    ),
    register('labelStudio.addPrinter', () => addPrinterCommand(explorer)),

    // ----------------------------------------------------------------- misc
    register('labelStudio.refreshExplorer', () => explorer.refresh()),
    register('labelStudio.showOutput', () => output.show(true)),
  ];

  // The extension was called ZPL Viewer before it spoke more than one printer
  // language; keep the old command ids working for existing keybindings and
  // tasks.
  const aliases: Record<string, string> = {
    'zplViewer.preview': 'labelStudio.preview',
    'zplViewer.previewToSide': 'labelStudio.previewToSide',
    'zplViewer.refreshPreview': 'labelStudio.refreshPreview',
    'zplViewer.exportPng': 'labelStudio.exportPng',
    'zplViewer.exportPdf': 'labelStudio.exportPdf',
    'zplViewer.formatDocument': 'labelStudio.formatDocument',
    'zplViewer.validate': 'labelStudio.validate',
    'zplViewer.insertTemplate': 'labelStudio.insertTemplate',
  };
  for (const [legacy, modern] of Object.entries(aliases)) {
    disposables.push(
      register(legacy, (...args: unknown[]) =>
        vscode.commands.executeCommand(modern, ...args),
      ),
    );
  }

  return disposables;
}

// ---------------------------------------------------------------- helpers

function requireLabelEditor(): vscode.TextEditor | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isLabelFormatId(editor.document.languageId)) {
    void vscode.window.showWarningMessage(
      'Open a label document (.zpl, .epl, .prn, .lbl) before running this command.',
    );
    return undefined;
  }
  return editor;
}

async function openDocument(
  content: string,
  language: string,
  toSide = false,
): Promise<vscode.TextDocument> {
  const document = await vscode.workspace.openTextDocument({
    content,
    language,
  });
  await vscode.window.showTextDocument(document, {
    preview: false,
    viewColumn: toSide ? vscode.ViewColumn.Beside : undefined,
  });
  return document;
}

async function pickWorkspaceFile(
  glob: string,
  placeHolder: string,
  filters: Record<string, string[]>,
): Promise<vscode.Uri | undefined> {
  const files = await vscode.workspace.findFiles(
    glob,
    '**/{node_modules,out,dist,.git}/**',
    200,
  );
  const browse = '$(folder-opened) Browse…';
  const picks = [
    ...files
      .map((uri) => vscode.workspace.asRelativePath(uri))
      .sort((a, b) => a.localeCompare(b)),
    browse,
  ];
  const choice = await vscode.window.showQuickPick(picks, { placeHolder });
  if (!choice) {
    return undefined;
  }
  if (choice === browse) {
    const selected = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters,
    });
    return selected?.[0];
  }
  return files[picks.indexOf(choice)];
}

async function readTextFile(uri: vscode.Uri): Promise<string> {
  const bytes = await vscode.workspace.fs.readFile(uri);
  return Buffer.from(bytes).toString('utf8');
}

// ------------------------------------------------------------ view/export

async function exportLabel(
  preview: LabelPreviewManager,
  format: 'png' | 'pdf',
): Promise<void> {
  const editor = requireLabelEditor();
  if (!editor) {
    return;
  }
  const defaultUri = editor.document.uri.with({
    path: editor.document.uri.path.replace(/\.[^./]+$/, '') + '.' + format,
  });
  const target = await vscode.window.showSaveDialog({
    defaultUri,
    filters:
      format === 'pdf' ? { 'PDF Document': ['pdf'] } : { 'PNG Image': ['png'] },
  });
  if (!target) {
    return;
  }
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Exporting label as ${format.toUpperCase()}…`,
      cancellable: false,
    },
    async () => {
      const bytes = await preview.export(editor.document, format);
      await vscode.workspace.fs.writeFile(target, bytes);
    },
  );
  const open = 'Open';
  const choice = await vscode.window.showInformationMessage(
    `Exported to ${target.fsPath}`,
    open,
  );
  if (choice === open) {
    await vscode.env.openExternal(target);
  }
}

// ------------------------------------------------------------------ create

async function insertStarterSnippet(): Promise<void> {
  const editor = requireLabelEditor();
  if (!editor) {
    return;
  }
  const snippet =
    formatOfDocument(editor.document) === 'epl'
      ? new vscode.SnippetString(
          ['N', 'q${1:812}', 'Q${2:406},24', 'A${3:50},${4:50},0,3,1,1,N,"${5:Hello}"', 'P1', ''].join('\n'),
        )
      : new vscode.SnippetString(
          ['^XA', '^CF0,30', '^FO${1:50},${2:50}^FD${3:Hello, label}^FS', '^XZ', ''].join('\n'),
        );
  await editor.insertSnippet(snippet);
}

async function newFromTemplate(templateId?: string): Promise<void> {
  let id = templateId;
  if (!id) {
    const choice = await vscode.window.showQuickPick(
      LABEL_TEMPLATES.map((template) => ({
        label: template.label,
        description: `${template.format.toUpperCase()} · ${template.widthInches}x${template.heightInches}"`,
        detail: template.description,
        id: template.id,
      })),
      { placeHolder: 'Pick a starter label template' },
    );
    id = choice?.id;
  }
  const template = id ? findTemplate(id) : undefined;
  if (!template) {
    return;
  }
  const keepPlaceholders = 'Keep {{placeholders}}';
  const useSamples = 'Fill with sample data';
  const mode =
    template.placeholders.length === 0
      ? useSamples
      : await vscode.window.showQuickPick([useSamples, keepPlaceholders], {
          placeHolder: `${template.label} has ${template.placeholders.length} data fields`,
        });
  if (!mode) {
    return;
  }
  const source =
    mode === keepPlaceholders ? template.source : fillTemplateSample(template);
  await openDocument(source, template.format);
  void vscode.window.showInformationMessage(
    `${template.label} created (${template.widthInches}x${template.heightInches}" at ${template.dpmm} dpmm).`,
  );
}

async function convertActiveDocument(): Promise<void> {
  const editor = requireLabelEditor();
  if (!editor) {
    return;
  }
  const from = formatOfDocument(editor.document);
  const targets = ALL_FORMAT_IDS.filter((id) => id !== from);
  const choice = await vscode.window.showQuickPick(
    targets.map((id) => ({
      label: LABEL_FORMATS[id].label,
      detail: LABEL_FORMATS[id].description,
      id,
    })),
    { placeHolder: `Convert ${LABEL_FORMATS[from].label} to…` },
  );
  if (!choice) {
    return;
  }
  const render = getRenderConfig();
  const converted = convertLabel(editor.document.getText(), choice.id, {
    format: from,
    dpmm: render.dpmm,
    widthInches: render.widthInches,
    heightInches: render.heightInches,
  });
  await openDocument(converted.text, choice.id, true);
  if (converted.warnings.length > 0) {
    void vscode.window.showWarningMessage(
      `Converted ${converted.pages} label(s) with ${converted.warnings.length} approximation(s).`,
      'Show details',
    ).then((action) => {
      if (action === 'Show details') {
        void openDocument(
          [
            `# ${LABEL_FORMATS[from].label} → ${LABEL_FORMATS[choice.id].label}`,
            '',
            ...converted.warnings.map((warning) => `- ${warning}`),
            '',
          ].join('\n'),
          'markdown',
        );
      }
    });
  } else {
    void vscode.window.showInformationMessage(
      `Converted ${converted.pages} label(s) to ${LABEL_FORMATS[choice.id].label}.`,
    );
  }
}

// ---------------------------------------------------------------- barcodes

async function insertBarcodeField(): Promise<void> {
  const editor = requireLabelEditor();
  if (!editor) {
    return;
  }
  const format = formatOfDocument(editor.document);
  const pick = await vscode.window.showQuickPick(
    SYMBOLOGIES.filter((spec) =>
      format === 'epl' ? spec.eplCode || spec.epl2dCode : spec.zplCommand,
    ).map((spec) => ({
      label: spec.label,
      description: spec.kind === '2d' ? '2-D' : spec.kind,
      detail: spec.description,
      id: spec.id,
    })),
    { placeHolder: 'Pick a barcode symbology' },
  );
  if (!pick) {
    return;
  }
  const spec = findSymbology(pick.id);
  if (!spec) {
    return;
  }
  const data = await vscode.window.showInputBox({
    prompt: `${spec.label} data`,
    value: spec.example,
    validateInput: (value) => {
      const issues = validateBarcodeData(spec.id, value).filter(
        (issue) => issue.severity === 'error',
      );
      return issues.length > 0 ? issues[0].message : undefined;
    },
  });
  if (data === undefined) {
    return;
  }
  const render = getRenderConfig();
  const page = {
    width: Math.round(render.widthInches * render.dpmm * 25.4),
    height: Math.round(render.heightInches * render.dpmm * 25.4),
    homeX: 0,
    homeY: 0,
    ops: [
      {
        type: 'barcode' as const,
        symbology: spec.id,
        data,
        moduleWidth: 2,
        ratio: 3,
        height: 80,
        interpretation: true,
        interpretationAbove: false,
        magnification: 5,
        errorCorrection: spec.id === 'qrcode' ? 'Q' : undefined,
        x: 50,
        y: 50,
        rotation: 'N' as const,
        reverse: false,
      },
    ],
  };
  const snippet =
    format === 'epl'
      ? emitEplPage(page, { includeSetup: false, dpmm: render.dpmm })
      : emitZplPage(page, { includeSetup: false })
          .replace(/^\^XA\n/, '')
          .replace(/\n\^XZ$/, '');
  await editor.insertSnippet(
    new vscode.SnippetString(snippet.replace(/\$/g, '\\$') + '\n'),
  );
}

// ------------------------------------------------------------------ import

async function importImageCommand(): Promise<void> {
  const selected = await vscode.window.showOpenDialog({
    canSelectMany: false,
    filters: { 'PNG image': ['png'] },
    title: 'Import artwork as a label graphic',
  });
  const uri = selected?.[0];
  if (!uri) {
    return;
  }
  const config = getImportConfig();
  const editor = vscode.window.activeTextEditor;
  const format =
    editor && isLabelFormatId(editor.document.languageId)
      ? formatOfDocument(editor.document)
      : 'zpl';

  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    const imported = importImage(bytes, {
      threshold: config.threshold,
      dither: config.dither,
      maxWidth: config.maxWidthDots,
    });
    const field =
      format === 'epl'
        ? bitmapToEplGraphicWrite(imported.bitmap, { x: 20, y: 20 })
        : bitmapToZplGraphicField(imported.bitmap, { x: 20, y: 20 });

    if (editor && isLabelFormatId(editor.document.languageId)) {
      await editor.edit((builder) =>
        builder.insert(editor.selection.active, field + '\n'),
      );
    } else {
      await openDocument(
        format === 'epl'
          ? `N\n${field}\nP1\n`
          : `^XA\n${field}\n^XZ\n`,
        format,
      );
    }
    const message = `Imported ${imported.sourceWidth}x${imported.sourceHeight} image as a ${imported.bitmap.width}x${imported.bitmap.height} dot graphic (${Math.round(imported.bitmap.coverage * 100)}% ink).`;
    if (imported.warnings.length > 0) {
      void vscode.window.showWarningMessage(
        `${message} ${imported.warnings.join(' ')}`,
      );
    } else {
      void vscode.window.showInformationMessage(message);
    }
  } catch (err) {
    void vscode.window.showErrorMessage(
      `Image import failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function importCaptureCommand(): Promise<void> {
  const selected = await vscode.window.showOpenDialog({
    canSelectMany: false,
    filters: { 'Printer capture': ['prn', 'txt', 'spl', 'bin', 'lbl'] },
    title: 'Import a printer capture',
  });
  const uri = selected?.[0];
  if (!uri) {
    return;
  }
  const raw = await readTextFile(uri);
  const result = importCapture(raw);
  await openDocument(result.text, result.format);
  const summary = `Imported ${result.labels.length} label(s) as ${LABEL_FORMATS[result.format].label}.`;
  if (result.warnings.length > 0) {
    void vscode.window.showWarningMessage(`${summary} ${result.warnings.join(' ')}`);
  } else {
    void vscode.window.showInformationMessage(summary);
  }
}

// -------------------------------------------------------------------- data

async function pickDataSource(uri?: vscode.Uri): Promise<vscode.Uri | undefined> {
  return (
    uri ??
    (await pickWorkspaceFile(
      '**/*.{csv,tsv,psv,json,jsonl,ndjson}',
      'Pick a data source',
      { 'Data files': ['csv', 'tsv', 'psv', 'json', 'jsonl', 'ndjson'] },
    ))
  );
}

async function previewDataSource(uri?: vscode.Uri): Promise<void> {
  const target = await pickDataSource(uri);
  if (!target) {
    return;
  }
  const dataset = loadDataset(await readTextFile(target), target.fsPath);
  await openDocument(datasetToMarkdown(dataset), 'markdown', true);
}

async function mergeDataCommand(uri?: vscode.Uri): Promise<void> {
  const editor = requireLabelEditor();
  if (!editor) {
    return;
  }
  const target = await pickDataSource(uri);
  if (!target) {
    return;
  }
  const template = editor.document.getText();
  const format = formatOfDocument(editor.document);
  const dataset = loadDataset(await readTextFile(target), target.fsPath);
  const mapping = analyzeMapping(template, dataset);

  if (templateFields(template).length === 0) {
    const proceed = await vscode.window.showWarningMessage(
      'This label has no {{placeholders}}, so every merged label would be identical.',
      'Merge anyway',
      'Cancel',
    );
    if (proceed !== 'Merge anyway') {
      return;
    }
  } else if (mapping.unresolved.length > 0) {
    const proceed = await vscode.window.showWarningMessage(
      `${mapping.unresolved.length} placeholder(s) have no column in ${dataset.name}: ${mapping.unresolved
        .map((name) => `{{${name}}}`)
        .join(', ')}`,
      'Merge anyway',
      'Show mapping',
      'Cancel',
    );
    if (proceed === 'Show mapping') {
      await openDocument(mappingToMarkdown(mapping, dataset), 'markdown', true);
      return;
    }
    if (proceed !== 'Merge anyway') {
      return;
    }
  }

  const merged = mergeDataset(template, dataset, {
    format,
    maxRows: getMergeConfig().maxRows,
  });
  await openDocument(merged.text, format, true);
  const summary = `Merged ${merged.labelCount} label(s) from ${dataset.name}.`;
  if (merged.warnings.length > 0) {
    void vscode.window.showWarningMessage(`${summary} ${merged.warnings.join(' ')}`);
  } else {
    void vscode.window.showInformationMessage(summary);
  }
}

async function checkMappingCommand(uri?: vscode.Uri): Promise<void> {
  const editor = requireLabelEditor();
  if (!editor) {
    return;
  }
  const target = await pickDataSource(uri);
  if (!target) {
    return;
  }
  const dataset = loadDataset(await readTextFile(target), target.fsPath);
  const mapping = analyzeMapping(editor.document.getText(), dataset);
  await openDocument(mappingToMarkdown(mapping, dataset), 'markdown', true);
}

// ---------------------------------------------------------------- analysis

async function analyzeCommand(): Promise<void> {
  const editor = requireLabelEditor();
  if (!editor) {
    return;
  }
  const source = editor.document.getText();
  const format = formatOfDocument(editor.document);
  const render = getRenderConfig();
  const parsed = parseLabel(source, {
    format,
    fileName: editor.document.fileName,
    dpmm: render.dpmm,
    widthInches: render.widthInches,
    heightInches: render.heightInches,
  });
  const analysis = analyzeLabel(parsed, source);
  const diagnostics = validateLabelSource(source, {
    format,
    fileName: editor.document.fileName,
    dpmm: render.dpmm,
    widthInches: render.widthInches,
    heightInches: render.heightInches,
  });
  const name = editor.document.uri.path.split('/').pop() ?? 'label';
  await openDocument(
    renderAnalysisMarkdown(analysis, diagnostics, name),
    'markdown',
    true,
  );
}

// ------------------------------------------------------------------ deploy

async function pickPrinter(name?: string): Promise<PrinterProfile | undefined> {
  const printers = getPrinters();
  if (printers.length === 0) {
    const add = 'Add a printer';
    const choice = await vscode.window.showWarningMessage(
      'No printers are configured. Add one to deploy labels.',
      add,
    );
    if (choice === add) {
      await vscode.commands.executeCommand('labelStudio.addPrinter');
    }
    return undefined;
  }
  if (name) {
    const match = printers.find((printer) => printer.name === name);
    if (match) {
      return match;
    }
  }
  if (printers.length === 1) {
    return printers[0];
  }
  const choice = await vscode.window.showQuickPick(
    printers.map((printer) => ({
      label: printer.name,
      description: describePrinter(printer),
      detail: printer.description,
      name: printer.name,
    })),
    { placeHolder: 'Deploy to which printer?' },
  );
  return printers.find((printer) => printer.name === choice?.name);
}

async function deployCommand(
  output: vscode.OutputChannel,
  name: string | undefined,
  dryRun: boolean,
): Promise<void> {
  const editor = requireLabelEditor();
  if (!editor) {
    return;
  }
  const profile = await pickPrinter(name);
  if (!profile) {
    return;
  }
  const source = editor.document.getText();
  const format = formatOfDocument(editor.document);
  const parsed = parseLabel(source, { format, dpmm: profile.dpmm });
  const config = getDeployConfig();

  if (!dryRun && config.confirmBeforeSend) {
    const send = 'Send';
    const confirmation = await vscode.window.showWarningMessage(
      `Send ${parsed.pages.length} label(s) to ${profile.name} (${describePrinter(profile)})?`,
      { modal: true },
      send,
    );
    if (confirmation !== send) {
      return;
    }
  }

  const outcome = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: dryRun
        ? `Building payload for ${profile.name}…`
        : `Sending ${parsed.pages.length} label(s) to ${profile.name}…`,
      cancellable: false,
    },
    () =>
      deployLabel({
        profile,
        source,
        format,
        fileName: editor.document.fileName,
        dryRun,
        send: { timeoutMs: config.timeoutMs },
      }),
  );

  output.appendLine(
    `[deploy] ${new Date().toISOString()} ${profile.name} (${outcome.target}) — ${
      outcome.ok ? 'ok' : 'failed'
    }${outcome.result ? `, ${outcome.result.bytesSent} bytes in ${outcome.result.durationMs}ms` : ''}`,
  );
  for (const warning of outcome.warnings) {
    output.appendLine(`[deploy]   ${warning}`);
  }
  if (outcome.result?.response) {
    output.appendLine(`[deploy]   printer said: ${outcome.result.response}`);
  }
  if (outcome.error) {
    output.appendLine(`[deploy]   error: ${outcome.error}`);
  }

  if (dryRun) {
    await openDocument(outcome.payload, profile.format, true);
    void vscode.window.showInformationMessage(
      `Dry run for ${profile.name}: ${outcome.payload.length} bytes prepared${
        outcome.converted ? ` (converted to ${profile.format.toUpperCase()})` : ''
      }.`,
    );
    return;
  }

  if (!outcome.ok) {
    const showLog = 'Show log';
    const choice = await vscode.window.showErrorMessage(
      `Deploy to ${profile.name} failed: ${outcome.error}`,
      showLog,
    );
    if (choice === showLog) {
      output.show(true);
    }
    return;
  }

  void vscode.window.showInformationMessage(
    `Sent ${outcome.result?.bytesSent ?? 0} bytes to ${profile.name} in ${outcome.result?.durationMs ?? 0}ms.`,
  );
}

async function addPrinterCommand(explorer: LabelExplorer): Promise<void> {
  const name = await vscode.window.showInputBox({
    prompt: 'Printer name',
    placeHolder: 'Warehouse ZT411',
    validateInput: (value) =>
      value.trim().length === 0 ? 'A name is required.' : undefined,
  });
  if (!name) {
    return;
  }
  const transport = await vscode.window.showQuickPick(
    [
      {
        label: 'Network (raw TCP)',
        detail: 'Send to a printer on port 9100 — the usual choice.',
        id: 'tcp' as const,
      },
      {
        label: 'File or device',
        detail: 'Write to a device node or share, e.g. /dev/usb/lp0.',
        id: 'file' as const,
      },
      {
        label: 'Spool directory',
        detail: 'Drop a timestamped file into a watched folder.',
        id: 'directory' as const,
      },
    ],
    { placeHolder: 'How should labels reach this printer?' },
  );
  if (!transport) {
    return;
  }

  let host: string | undefined;
  let port = 9100;
  let targetPath: string | undefined;
  if (transport.id === 'tcp') {
    host = await vscode.window.showInputBox({
      prompt: 'Printer hostname or IP address',
      placeHolder: '192.168.1.50',
      validateInput: (value) =>
        value.trim().length === 0 ? 'A host is required.' : undefined,
    });
    if (!host) {
      return;
    }
    const portText = await vscode.window.showInputBox({
      prompt: 'Port',
      value: '9100',
    });
    if (portText === undefined) {
      return;
    }
    port = parseInt(portText, 10) || 9100;
  } else {
    targetPath = await vscode.window.showInputBox({
      prompt:
        transport.id === 'file' ? 'Device or file path' : 'Spool directory path',
      placeHolder: transport.id === 'file' ? '/dev/usb/lp0' : './spool',
      validateInput: (value) =>
        value.trim().length === 0 ? 'A path is required.' : undefined,
    });
    if (!targetPath) {
      return;
    }
  }

  const formatPick = await vscode.window.showQuickPick(
    ALL_FORMAT_IDS.map((id) => ({
      label: LABEL_FORMATS[id].label,
      detail: LABEL_FORMATS[id].vendors.join(', '),
      id,
    })),
    { placeHolder: 'Which language does this printer speak?' },
  );
  if (!formatPick) {
    return;
  }
  const densityPick = await vscode.window.showQuickPick(
    ['6 dpmm (152 dpi)', '8 dpmm (203 dpi)', '12 dpmm (300 dpi)', '24 dpmm (600 dpi)'],
    { placeHolder: 'Print density' },
  );
  if (!densityPick) {
    return;
  }

  const profile: Record<string, unknown> = {
    name: name.trim(),
    transport: transport.id,
    format: formatPick.id,
    dpmm: parseInt(densityPick, 10),
  };
  if (host) {
    profile.host = host.trim();
    profile.port = port;
  }
  if (targetPath) {
    profile.path = targetPath.trim();
  }

  const scope = await vscode.window.showQuickPick(
    ['Workspace (shared with the repository)', 'User (this machine only)'],
    { placeHolder: 'Where should this printer be saved?' },
  );
  if (!scope) {
    return;
  }
  const target = scope.startsWith('Workspace')
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;

  const configuration = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const existing = configuration.get<unknown[]>('printers', []);
  await configuration.update('printers', [...existing, profile], target);
  explorer.refresh();
  void vscode.window.showInformationMessage(`Printer "${profile.name}" added.`);
}
