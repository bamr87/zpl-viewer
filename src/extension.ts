import * as vscode from 'vscode';
import { ZplHoverProvider } from './providers/hoverProvider';
import { ZplCompletionProvider } from './providers/completionProvider';
import { ZplSymbolProvider } from './providers/symbolProvider';
import { ZplFormatter } from './providers/formatter';
import { ZplFoldingProvider } from './providers/foldingProvider';
import { ZplDiagnostics } from './diagnostics';
import { ZplPreviewManager } from './previewPanel';

const SELECTOR_ANY: vscode.DocumentSelector = { language: 'zpl' };

export function activate(context: vscode.ExtensionContext): void {
  const diagnostics = new ZplDiagnostics();
  const preview = new ZplPreviewManager(context);

  context.subscriptions.push(
    vscode.languages.registerHoverProvider(SELECTOR_ANY, new ZplHoverProvider()),
    vscode.languages.registerCompletionItemProvider(
      SELECTOR_ANY,
      new ZplCompletionProvider(),
      '^',
      '~',
    ),
    vscode.languages.registerDocumentSymbolProvider(
      SELECTOR_ANY,
      new ZplSymbolProvider(),
    ),
    vscode.languages.registerDocumentFormattingEditProvider(
      SELECTOR_ANY,
      new ZplFormatter(),
    ),
    vscode.languages.registerFoldingRangeProvider(
      SELECTOR_ANY,
      new ZplFoldingProvider(),
    ),
    diagnostics,
    preview,
  );

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => diagnostics.refresh(doc)),
    vscode.workspace.onDidChangeTextDocument((e) =>
      diagnostics.refresh(e.document),
    ),
    vscode.workspace.onDidCloseTextDocument((doc) => diagnostics.clear(doc)),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('zplViewer.validation')) {
        for (const doc of vscode.workspace.textDocuments) {
          diagnostics.refresh(doc);
        }
      }
    }),
  );
  for (const doc of vscode.workspace.textDocuments) {
    diagnostics.refresh(doc);
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('zplViewer.preview', () => {
      const editor = requireZplEditor();
      if (editor) {
        preview.show(editor.document, false);
      }
    }),
    vscode.commands.registerCommand('zplViewer.previewToSide', () => {
      const editor = requireZplEditor();
      if (editor) {
        preview.show(editor.document, true);
      }
    }),
    vscode.commands.registerCommand('zplViewer.refreshPreview', () => {
      preview.refreshActive();
    }),
    vscode.commands.registerCommand('zplViewer.exportPng', () =>
      exportLabel(preview, 'png'),
    ),
    vscode.commands.registerCommand('zplViewer.exportPdf', () =>
      exportLabel(preview, 'pdf'),
    ),
    vscode.commands.registerCommand('zplViewer.formatDocument', async () => {
      const editor = requireZplEditor();
      if (!editor) {
        return;
      }
      await vscode.commands.executeCommand('editor.action.formatDocument');
    }),
    vscode.commands.registerCommand('zplViewer.validate', () => {
      const editor = requireZplEditor();
      if (editor) {
        diagnostics.refresh(editor.document);
        vscode.window.showInformationMessage('ZPL validation refreshed.');
      }
    }),
    vscode.commands.registerCommand('zplViewer.insertTemplate', async () => {
      const editor = requireZplEditor();
      if (!editor) {
        return;
      }
      const snippet = new vscode.SnippetString(
        [
          '^XA',
          '^CF0,30',
          '^FO${1:50},${2:50}^FD${3:Hello, ZPL}^FS',
          '^XZ',
          '',
        ].join('\n'),
      );
      await editor.insertSnippet(snippet);
    }),
  );

  if (process.env.VSCODE_ZPL_TEST === '1') {
    context.subscriptions.push(
      vscode.commands.registerCommand(
        'zplViewer._test.waitForPreviewReady',
        async (uri: vscode.Uri, timeoutMs?: number) => {
          await preview.waitForReady(uri, timeoutMs);
        },
      ),
    );
  }
}

export function deactivate(): void {
  // intentionally empty; subscriptions handle cleanup
}

function requireZplEditor(): vscode.TextEditor | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'zpl') {
    void vscode.window.showWarningMessage(
      'Open a ZPL document before running this command.',
    );
    return undefined;
  }
  return editor;
}

async function exportLabel(
  preview: ZplPreviewManager,
  format: 'png' | 'pdf',
): Promise<void> {
  const editor = requireZplEditor();
  if (!editor) {
    return;
  }
  const defaultUri = defaultExportUri(editor.document.uri, format);
  const target = await vscode.window.showSaveDialog({
    defaultUri,
    filters:
      format === 'pdf'
        ? { 'PDF Document': ['pdf'] }
        : { 'PNG Image': ['png'] },
  });
  if (!target) {
    return;
  }
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Exporting ZPL label as ${format.toUpperCase()}…`,
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

function defaultExportUri(source: vscode.Uri, format: 'png' | 'pdf'): vscode.Uri {
  const path = source.path.replace(/\.[^./]+$/, '') + '.' + format;
  return source.with({ path });
}
