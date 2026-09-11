import * as vscode from 'vscode';
import { LabelHoverProvider } from './providers/hoverProvider';
import { LabelCompletionProvider } from './providers/completionProvider';
import { LabelSymbolProvider } from './providers/symbolProvider';
import { LabelFormatter } from './providers/formatter';
import { LabelFoldingProvider } from './providers/foldingProvider';
import { LabelDiagnostics } from './diagnostics';
import { LabelPreviewManager } from './previewPanel';
import { ALL_FORMAT_IDS, LABEL_FORMATS, isLabelFormatId } from './core/formats';
import { registerLabelExplorer } from './ui/labelExplorer';
import { registerCommands } from './ui/commands';
import { affectsLabelStudio } from './config';

/** Every label language the extension contributes providers for. */
const LABEL_SELECTOR: vscode.DocumentSelector = ALL_FORMAT_IDS.map((id) => ({
  language: LABEL_FORMATS[id].languageId,
}));

export function activate(context: vscode.ExtensionContext): void {
  const diagnostics = new LabelDiagnostics();
  const preview = new LabelPreviewManager(context);
  const output = vscode.window.createOutputChannel('Label Studio: Deploy');
  const explorer = registerLabelExplorer(context);

  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      LABEL_SELECTOR,
      new LabelHoverProvider(),
    ),
    vscode.languages.registerCompletionItemProvider(
      LABEL_SELECTOR,
      new LabelCompletionProvider(),
      '^',
      '~',
    ),
    vscode.languages.registerDocumentSymbolProvider(
      LABEL_SELECTOR,
      new LabelSymbolProvider(),
    ),
    vscode.languages.registerDocumentFormattingEditProvider(
      LABEL_SELECTOR,
      new LabelFormatter(),
    ),
    vscode.languages.registerFoldingRangeProvider(
      LABEL_SELECTOR,
      new LabelFoldingProvider(),
    ),
    diagnostics,
    preview,
    output,
  );

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => diagnostics.refresh(doc)),
    vscode.workspace.onDidChangeTextDocument((e) =>
      diagnostics.refresh(e.document),
    ),
    vscode.workspace.onDidCloseTextDocument((doc) => diagnostics.clear(doc)),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (affectsLabelStudio(e, 'validation') || affectsLabelStudio(e, 'label')) {
        diagnostics.refreshAll();
      }
      if (affectsLabelStudio(e, 'printers')) {
        explorer.refresh();
      }
    }),
  );
  diagnostics.refreshAll();

  context.subscriptions.push(
    ...registerCommands({ context, preview, diagnostics, explorer, output }),
  );

  if (process.env.VSCODE_ZPL_TEST === '1') {
    context.subscriptions.push(
      vscode.commands.registerCommand(
        'labelStudio._test.waitForPreviewReady',
        async (uri: vscode.Uri, timeoutMs?: number) => {
          await preview.waitForReady(uri, timeoutMs);
        },
      ),
      vscode.commands.registerCommand(
        'zplViewer._test.waitForPreviewReady',
        async (uri: vscode.Uri, timeoutMs?: number) => {
          await preview.waitForReady(uri, timeoutMs);
        },
      ),
    );
  }

  // Label files without a dedicated extension (.prn, .lbl) open as ZPL by
  // default; re-validate when a user switches the language mode by hand.
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && isLabelFormatId(editor.document.languageId)) {
        diagnostics.refresh(editor.document);
      }
    }),
  );
}

export function deactivate(): void {
  // intentionally empty; subscriptions handle cleanup
}
