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
  labelFileExtensions,
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
import { pagesToSvg } from '../emit/svg';
import { BwipSvgRenderer } from '../barcode/svgRenderer';
import { supportedImageExtensions } from '../image/decode';
import { labelFormattingEdits } from '../providers/formatter';
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
  getSetting,
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
    register('labelStudio.preview', async (target?: unknown) => {
      const document = await resolveLabelDocument(target);
      if (document) {
        preview.show(document, false);
      }
    }),
    register('labelStudio.previewToSide', async (target?: unknown) => {
      const document = await resolveLabelDocument(target);
      if (document) {
        preview.show(document, true);
      }
    }),
    register('labelStudio.refreshPreview', () => preview.refreshActive()),
    register('labelStudio.exportPng', (target?: unknown) =>
      exportLabel(preview, 'png', target),
    ),
    register('labelStudio.exportPdf', (target?: unknown) =>
      exportLabel(preview, 'pdf', target),
    ),
    register('labelStudio.exportSvg', (target?: unknown) => exportSvgCommand(target)),

    // ---------------------------------------------------------------- edit
    register('labelStudio.formatDocument', async (target?: unknown) => {
      const editor = await resolveLabelEditor(target);
      if (!editor) {
        return;
      }
      // Apply the edits here rather than delegating to
      // `editor.action.formatDocument`: that command formats whichever code
      // editor has focus, which is not this one when the label was picked in
      // the Labels view, and is nothing at all while a preview webview holds
      // focus.
      const edits = labelFormattingEdits(editor.document);
      if (edits.length === 0) {
        return;
      }
      const edit = new vscode.WorkspaceEdit();
      edit.set(editor.document.uri, edits);
      await vscode.workspace.applyEdit(edit);
    }),
    register('labelStudio.validate', async (target?: unknown) => {
      const document = await resolveLabelDocument(target);
      if (!document) {
        return;
      }
      diagnostics.refresh(document);
      const findings = validateLabelSource(document.getText(), {
        format: formatOfDocument(document),
        fileName: document.fileName,
      });
      void vscode.window.showInformationMessage(
        findings.length === 0
          ? 'Label is valid — no findings.'
          : `Validation complete: ${findings.length} finding(s). See the Problems panel.`,
      );
    }),
    register('labelStudio.insertTemplate', () => insertStarterSnippet()),
    register('labelStudio.newFromTemplate', (templateId?: unknown) =>
      newFromTemplate(
        typeof templateId === 'string'
          ? templateId
          : (templateId as { id?: string } | undefined)?.id,
      ),
    ),
    register('labelStudio.convertFormat', (target?: unknown) =>
      convertActiveDocument(target),
    ),

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
    register('labelStudio.previewDataSource', (target?: unknown) =>
      previewDataSource(targetUri(target)),
    ),
    register('labelStudio.mergeData', (target?: unknown) =>
      mergeDataCommand(target),
    ),
    register('labelStudio.checkMapping', (target?: unknown) =>
      checkMappingCommand(target),
    ),

    // ------------------------------------------------------------- analysis
    register('labelStudio.analyze', (target?: unknown) => analyzeCommand(target)),

    // --------------------------------------------------------------- deploy
    register('labelStudio.deploy', (target?: unknown) =>
      deployCommand(output, target, false),
    ),
    register('labelStudio.deployDryRun', (target?: unknown) =>
      deployCommand(output, target, true),
    ),
    register('labelStudio.addPrinter', () => addPrinterCommand(explorer)),
    register('labelStudio.editPrinter', (target?: unknown) =>
      editPrinterCommand(target),
    ),
    register('labelStudio.removePrinter', (target?: unknown) =>
      removePrinterCommand(explorer, target),
    ),

    // ---------------------------------------------------------- settings
    register('labelStudio.openSettings', () =>
      vscode.commands.executeCommand(
        'workbench.action.openSettings',
        `@ext:${EXTENSION_ID}`,
      ),
    ),
    register('labelStudio.setDensity', () => setDensityCommand()),
    register('labelStudio.setLabelSize', () => setLabelSizeCommand()),

    // ----------------------------------------------------------------- misc
    register('labelStudio.showActions', (target?: unknown) =>
      showActionsCommand(target),
    ),
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

/**
 * The URI a command was invoked on, if any.
 *
 * A command reached from a tree item, an explorer selection or a menu is handed
 * its target; the same command from the palette or a keybinding is handed
 * nothing and falls back to the editor. Tree nodes are passed whole, so both
 * their own `uri` and the `resourceUri` VS Code sets are accepted.
 */
function targetUri(target?: unknown): vscode.Uri | undefined {
  if (target instanceof vscode.Uri) {
    return target;
  }
  if (target && typeof target === 'object') {
    const node = target as { uri?: unknown; resourceUri?: unknown };
    if (node.uri instanceof vscode.Uri) {
      return node.uri;
    }
    if (node.resourceUri instanceof vscode.Uri) {
      return node.resourceUri;
    }
  }
  return undefined;
}

/**
 * Resolves the label a command should act on: its explicit target, else the
 * active editor, else the one label editor on screen.
 *
 * The last fallback matters more than it looks. Running an export while the
 * preview panel has focus leaves `activeTextEditor` undefined, and refusing to
 * act there would be indistinguishable from a broken command.
 */
async function resolveLabelDocument(
  target?: unknown,
): Promise<vscode.TextDocument | undefined> {
  const uri = targetUri(target);
  if (uri) {
    try {
      return await vscode.workspace.openTextDocument(uri);
    } catch (err) {
      void vscode.window.showErrorMessage(
        `Could not open ${uri.fsPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return undefined;
    }
  }

  const active = vscode.window.activeTextEditor;
  if (active && isLabelFormatId(active.document.languageId)) {
    return active.document;
  }
  const visible = vscode.window.visibleTextEditors.find((editor) =>
    isLabelFormatId(editor.document.languageId),
  );
  if (visible) {
    return visible.document;
  }

  void vscode.window.showWarningMessage(
    'Open a label document (.zpl, .epl, .prn, .lbl), or pick one in the Labels view, before running this command.',
  );
  return undefined;
}

/** As {@link resolveLabelDocument}, but for commands that edit text. */
async function resolveLabelEditor(
  target?: unknown,
): Promise<vscode.TextEditor | undefined> {
  const document = await resolveLabelDocument(target);
  if (!document) {
    return undefined;
  }
  const existing = vscode.window.visibleTextEditors.find(
    (editor) => editor.document === document,
  );
  if (existing && vscode.window.activeTextEditor === existing) {
    return existing;
  }
  return vscode.window.showTextDocument(document, { preview: false });
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
  from?: unknown,
): Promise<void> {
  const document = await resolveLabelDocument(from);
  if (!document) {
    return;
  }
  const editor = { document };
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

/**
 * Exports the active label as SVG.
 *
 * Unlike PNG and PDF this never opens a preview panel: SVG is generated from
 * the IR as text, so the whole export runs in the extension host.
 */
async function exportSvgCommand(from?: unknown): Promise<void> {
  const document = await resolveLabelDocument(from);
  if (!document) {
    return;
  }
  const editor = { document };
  const render = getRenderConfig();
  const parsed = parseLabel(editor.document.getText(), {
    format: formatOfDocument(editor.document),
    dpmm: render.dpmm,
    widthInches: render.widthInches,
    heightInches: render.heightInches,
  });
  if (parsed.pages.length === 0) {
    void vscode.window.showWarningMessage('Nothing to export: the label has no pages.');
    return;
  }

  const base = editor.document.uri.path.replace(/\.[^./]+$/, '');
  const target = await vscode.window.showSaveDialog({
    defaultUri: editor.document.uri.with({ path: `${base}.svg` }),
    filters: { 'SVG Image': ['svg'] },
  });
  if (!target) {
    return;
  }

  const documents = pagesToSvg(parsed.pages, {
    dpmm: parsed.dpmm,
    barcodes: new BwipSvgRenderer(),
    title: basename(editor.document.uri.path),
  });

  // One file per label; a numbered suffix only when there is more than one, so
  // the single-label case writes exactly the name the user chose.
  const written: vscode.Uri[] = [];
  for (let index = 0; index < documents.length; index += 1) {
    const uri =
      documents.length === 1
        ? target
        : target.with({ path: target.path.replace(/\.svg$/i, `-${index + 1}.svg`) });
    await vscode.workspace.fs.writeFile(uri, Buffer.from(documents[index], 'utf8'));
    written.push(uri);
  }

  const open = 'Open';
  const choice = await vscode.window.showInformationMessage(
    written.length === 1
      ? `Exported to ${written[0].fsPath}`
      : `Exported ${written.length} labels next to ${written[0].fsPath}`,
    open,
  );
  if (choice === open) {
    await vscode.env.openExternal(written[0]);
  }
}

function basename(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] || path;
}

// ------------------------------------------------------------------ create

async function insertStarterSnippet(): Promise<void> {
  const editor = await resolveLabelEditor();
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

async function convertActiveDocument(target?: unknown): Promise<void> {
  const document = await resolveLabelDocument(target);
  if (!document) {
    return;
  }
  const editor = { document };
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
  const editor = await resolveLabelEditor();
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
    filters: { 'Image files': supportedImageExtensions() },
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
      invert: config.invert,
      trim: config.trim,
      rotate: config.rotate,
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
    const message = `Imported a ${imported.sourceWidth}x${imported.sourceHeight} ${imported.format} as a ${imported.bitmap.width}x${imported.bitmap.height} dot graphic (${Math.round(imported.bitmap.coverage * 100)}% ink).`;
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

async function mergeDataCommand(source?: unknown): Promise<void> {
  const document = await resolveLabelDocument(labelTarget(source));
  if (!document) {
    return;
  }
  const editor = { document };
  const target = await pickDataSource(dataTarget(source));
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

async function checkMappingCommand(source?: unknown): Promise<void> {
  const document = await resolveLabelDocument(labelTarget(source));
  if (!document) {
    return;
  }
  const editor = { document };
  const target = await pickDataSource(dataTarget(source));
  if (!target) {
    return;
  }
  const dataset = loadDataset(await readTextFile(target), target.fsPath);
  const mapping = analyzeMapping(editor.document.getText(), dataset);
  await openDocument(mappingToMarkdown(mapping, dataset), 'markdown', true);
}

// ---------------------------------------------------------------- analysis

async function analyzeCommand(target?: unknown): Promise<void> {
  const document = await resolveLabelDocument(target);
  if (!document) {
    return;
  }
  const editor = { document };
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
  target: unknown,
  dryRun: boolean,
): Promise<void> {
  // Deploy is reachable from two directions: from a printer in the Printers
  // view (which names the printer, and the label comes from the editor) and
  // from a label (which names the file, and the printer is picked).
  const document = await resolveLabelDocument(labelTarget(target));
  if (!document) {
    return;
  }
  const editor = { document };
  const profile = await pickPrinter(printerName(target));
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

// ------------------------------------------------------- command targets

/** The extension id, used to filter the Settings UI to this extension. */
const EXTENSION_ID = 'zpl-viewer.zpl-viewer';

/** A printer name carried by a Printers-view node (or passed directly). */
function printerName(target?: unknown): string | undefined {
  if (typeof target === 'string') {
    return target;
  }
  if (target && typeof target === 'object') {
    const node = target as { name?: unknown; transport?: unknown };
    if (typeof node.name === 'string' && typeof node.transport === 'string') {
      return node.name;
    }
  }
  return undefined;
}

/**
 * Commands like deploy and merge are reachable from both a label and a
 * non-label node (a printer, a data source). These two split a target so each
 * side only sees what it can use, instead of a printer node being mistaken for
 * a label and silently exporting the wrong thing.
 */
function labelTarget(target?: unknown): unknown {
  const uri = targetUri(target);
  return uri && isLabelUri(uri) ? uri : undefined;
}

function dataTarget(target?: unknown): vscode.Uri | undefined {
  const uri = targetUri(target);
  return uri && !isLabelUri(uri) ? uri : undefined;
}

function isLabelUri(uri: vscode.Uri): boolean {
  return labelFileExtensions().some((extension) =>
    uri.path.toLowerCase().endsWith(extension),
  );
}

// ---------------------------------------------------------------- printers

async function editPrinterCommand(target?: unknown): Promise<void> {
  const name = printerName(target) ?? (await pickPrinter())?.name;
  if (!name) {
    return;
  }
  // Printer profiles are structured settings; the JSON editor is the honest
  // place to change one, and it shows the scope the profile actually lives in.
  await vscode.commands.executeCommand(
    'workbench.action.openSettingsJson',
    { revealSetting: { key: `${CONFIG_SECTION}.printers` } },
  );
  void vscode.window.showInformationMessage(
    `Editing printers — find "${name}" in the ${CONFIG_SECTION}.printers array.`,
  );
}

async function removePrinterCommand(
  explorer: LabelExplorer,
  target?: unknown,
): Promise<void> {
  const name = printerName(target) ?? (await pickPrinter())?.name;
  if (!name) {
    return;
  }
  const remove = 'Remove';
  const confirmed = await vscode.window.showWarningMessage(
    `Remove printer "${name}"?`,
    { modal: true },
    remove,
  );
  if (confirmed !== remove) {
    return;
  }

  const configuration = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const inspected = configuration.inspect<unknown[]>('printers');
  // Remove from whichever scope actually defines it, so a workspace profile is
  // not silently shadowed by an untouched user-level one.
  const scopes: Array<[vscode.ConfigurationTarget, unknown[] | undefined]> = [
    [vscode.ConfigurationTarget.WorkspaceFolder, inspected?.workspaceFolderValue],
    [vscode.ConfigurationTarget.Workspace, inspected?.workspaceValue],
    [vscode.ConfigurationTarget.Global, inspected?.globalValue],
  ];

  let removed = false;
  for (const [scope, value] of scopes) {
    if (!Array.isArray(value)) {
      continue;
    }
    const kept = value.filter(
      (entry) => (entry as { name?: unknown })?.name !== name,
    );
    if (kept.length !== value.length) {
      await configuration.update('printers', kept, scope);
      removed = true;
    }
  }

  explorer.refresh();
  void vscode.window.showInformationMessage(
    removed
      ? `Printer "${name}" removed.`
      : `Printer "${name}" is not defined in a settings scope this window can edit.`,
  );
}

// ---------------------------------------------------------------- settings

async function setDensityCommand(): Promise<void> {
  const current = getSetting<string>('renderer.density', '8dpmm');
  const choice = await vscode.window.showQuickPick(
    DENSITY_CHOICES.map((density) => ({
      label: density.label,
      description: density.id === current ? 'current' : undefined,
      detail: density.detail,
      id: density.id,
    })),
    { placeHolder: 'Print density used to render labels' },
  );
  if (!choice) {
    return;
  }
  await vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .update('renderer.density', choice.id, vscode.ConfigurationTarget.Workspace);
}

const DENSITY_CHOICES = [
  { id: '6dpmm', label: '6 dpmm', detail: '152 dpi' },
  { id: '8dpmm', label: '8 dpmm', detail: '203 dpi — the most common' },
  { id: '12dpmm', label: '12 dpmm', detail: '300 dpi' },
  { id: '24dpmm', label: '24 dpmm', detail: '600 dpi' },
];

const STOCK_SIZES = [
  { label: '4 × 6"', detail: 'Shipping label', width: 4, height: 6 },
  { label: '4 × 2"', detail: 'Product label', width: 4, height: 2 },
  { label: '3 × 2"', detail: 'Asset tag', width: 3, height: 2 },
  { label: '2 × 1"', detail: 'Barcode / shelf label', width: 2, height: 1 },
];

async function setLabelSizeCommand(): Promise<void> {
  const custom = 'Custom…';
  const choice = await vscode.window.showQuickPick(
    [...STOCK_SIZES.map((size) => size.label), custom],
    { placeHolder: 'Label stock size' },
  );
  if (!choice) {
    return;
  }

  let width: number | undefined;
  let height: number | undefined;
  if (choice === custom) {
    width = await askInches('Label width in inches');
    if (width === undefined) {
      return;
    }
    height = await askInches('Label height in inches');
    if (height === undefined) {
      return;
    }
  } else {
    const size = STOCK_SIZES.find((entry) => entry.label === choice);
    width = size?.width;
    height = size?.height;
  }
  if (width === undefined || height === undefined) {
    return;
  }

  const configuration = vscode.workspace.getConfiguration(CONFIG_SECTION);
  await configuration.update(
    'label.widthInches',
    width,
    vscode.ConfigurationTarget.Workspace,
  );
  await configuration.update(
    'label.heightInches',
    height,
    vscode.ConfigurationTarget.Workspace,
  );
}

async function askInches(prompt: string): Promise<number | undefined> {
  const text = await vscode.window.showInputBox({
    prompt,
    validateInput: (value) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed > 0
        ? undefined
        : 'Enter a positive number of inches.';
    },
  });
  return text === undefined ? undefined : Number(text);
}

// -------------------------------------------------------------- action hub

interface LabelAction {
  label: string;
  detail: string;
  command: string;
  /** False for actions that make no sense without a label open. */
  needsLabel: boolean;
}

/**
 * Every action, in one list.
 *
 * This is what the status-bar item and the sidebar's Actions view both read,
 * so a command added here shows up in both places rather than only in the
 * palette — which is where all of this used to be reachable from.
 */
export const LABEL_ACTIONS: LabelAction[] = [
  {
    label: '$(open-preview) Open Preview to the Side',
    detail: 'Render this label next to the source',
    command: 'labelStudio.previewToSide',
    needsLabel: true,
  },
  {
    label: '$(graph) Analyze Label',
    detail: 'Metrics, ink coverage, barcode inventory and findings',
    command: 'labelStudio.analyze',
    needsLabel: true,
  },
  {
    label: '$(check) Validate Label',
    detail: 'Re-run diagnostics into the Problems panel',
    command: 'labelStudio.validate',
    needsLabel: true,
  },
  {
    label: '$(file-media) Export as PNG',
    detail: 'Save the first label as an image',
    command: 'labelStudio.exportPng',
    needsLabel: true,
  },
  {
    label: '$(file-pdf) Export as PDF',
    detail: 'Save every label as a multi-page PDF',
    command: 'labelStudio.exportPdf',
    needsLabel: true,
  },
  {
    label: '$(symbol-color) Export as SVG',
    detail: 'Vector export — no preview panel needed',
    command: 'labelStudio.exportSvg',
    needsLabel: true,
  },
  {
    label: '$(list-flat) Format Document',
    detail: "Run this language's formatter",
    command: 'labelStudio.formatDocument',
    needsLabel: true,
  },
  {
    label: '$(arrow-swap) Convert to Another Printer Language',
    detail: 'ZPL ↔ EPL, reporting every approximation',
    command: 'labelStudio.convertFormat',
    needsLabel: true,
  },
  {
    label: '$(symbol-color) Open Barcode Studio',
    detail: 'Build and validate a barcode interactively',
    command: 'labelStudio.openBarcodeStudio',
    needsLabel: false,
  },
  {
    label: '$(add) Insert Barcode Field',
    detail: 'Pick a symbology, type data, insert the field',
    command: 'labelStudio.insertBarcode',
    needsLabel: true,
  },
  {
    label: '$(file-media) Import Image as Label Graphic',
    detail: 'PNG or BMP artwork into a graphic field',
    command: 'labelStudio.importImage',
    needsLabel: false,
  },
  {
    label: '$(inbox) Import Printer Capture',
    detail: 'Clean a raw capture into editable labels',
    command: 'labelStudio.importCapture',
    needsLabel: false,
  },
  {
    label: '$(run-all) Merge Data Into Labels',
    detail: 'Expand this template over every row of a data source',
    command: 'labelStudio.mergeData',
    needsLabel: true,
  },
  {
    label: '$(checklist) Check Data Mapping',
    detail: 'Placeholder ↔ column report',
    command: 'labelStudio.checkMapping',
    needsLabel: true,
  },
  {
    label: '$(rocket) Deploy to Printer',
    detail: 'Send this label to a configured printer',
    command: 'labelStudio.deploy',
    needsLabel: true,
  },
  {
    label: '$(debug-step-over) Deploy (dry run)',
    detail: 'Build the payload without sending it',
    command: 'labelStudio.deployDryRun',
    needsLabel: true,
  },
  {
    label: '$(new-file) New Label from Template',
    detail: 'Start from a shipping, product, asset or GS1 template',
    command: 'labelStudio.newFromTemplate',
    needsLabel: false,
  },
  {
    label: '$(dashboard) Set Print Density',
    detail: 'Match the renderer to your printer resolution',
    command: 'labelStudio.setDensity',
    needsLabel: false,
  },
  {
    label: '$(screen-normal) Set Label Size',
    detail: 'Stock width and height in inches',
    command: 'labelStudio.setLabelSize',
    needsLabel: false,
  },
  {
    label: '$(gear) Label Studio Settings',
    detail: 'Open every setting this extension contributes',
    command: 'labelStudio.openSettings',
    needsLabel: false,
  },
];

/**
 * A quick pick of everything applicable right now — the status bar's click
 * target, and a discoverable way in for anyone who does not know a command's
 * name well enough to find it in the palette.
 */
async function showActionsCommand(target?: unknown): Promise<void> {
  const uri = targetUri(target);
  const hasLabel =
    uri !== undefined ||
    vscode.window.visibleTextEditors.some((editor) =>
      isLabelFormatId(editor.document.languageId),
    );

  const choice = await vscode.window.showQuickPick(
    LABEL_ACTIONS.filter((action) => hasLabel || !action.needsLabel).map(
      (action) => ({
        label: action.label,
        detail: action.detail,
        command: action.command,
      }),
    ),
    { placeHolder: 'Label Studio', matchOnDetail: true },
  );
  if (choice) {
    await vscode.commands.executeCommand(choice.command, uri);
  }
}
