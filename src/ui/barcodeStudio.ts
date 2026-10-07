import * as vscode from 'vscode';
import { LabelFormatId } from '../core/formats';
import { renderWebviewHtml } from './webviewHtml';

interface StudioMessage {
  type: string;
  snippet?: string;
  data?: number[];
  name?: string;
  message?: string;
}

/**
 * Host for the barcode studio webview: a single panel that builds, validates
 * and previews a symbol, and hands the resulting field back to the editor.
 */
export class BarcodeStudioPanel {
  private static current: BarcodeStudioPanel | undefined;

  private readonly disposables: vscode.Disposable[] = [];

  static show(
    context: vscode.ExtensionContext,
    options: { format?: LabelFormatId; data?: string } = {},
  ): void {
    if (BarcodeStudioPanel.current) {
      BarcodeStudioPanel.current.panel.reveal(vscode.ViewColumn.Active);
      BarcodeStudioPanel.current.initialize(options);
      return;
    }
    BarcodeStudioPanel.current = new BarcodeStudioPanel(context, options);
  }

  private readonly panel: vscode.WebviewPanel;

  private constructor(
    private readonly context: vscode.ExtensionContext,
    options: { format?: LabelFormatId; data?: string },
  ) {
    this.panel = vscode.window.createWebviewPanel(
      'labelStudio.barcodeStudio',
      'Barcode Studio',
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview'),
        ],
      },
    );
    this.panel.webview.html = renderWebviewHtml(
      this.panel.webview,
      this.context.extensionUri,
      'studio.html',
      'studio.js',
    );
    this.disposables.push(
      this.panel.webview.onDidReceiveMessage((message: StudioMessage) =>
        this.handleMessage(message, options),
      ),
    );
    this.panel.onDidDispose(() => this.dispose());
  }

  private initialize(options: { format?: LabelFormatId; data?: string }): void {
    void this.panel.webview.postMessage({
      type: 'init',
      format: options.format,
      data: options.data,
    });
  }

  private async handleMessage(
    message: StudioMessage,
    options: { format?: LabelFormatId; data?: string },
  ): Promise<void> {
    switch (message.type) {
      case 'ready':
        this.initialize(options);
        break;
      case 'insert':
        await insertSnippet(message.snippet ?? '');
        break;
      case 'copy':
        await vscode.env.clipboard.writeText(message.snippet ?? '');
        void vscode.window.showInformationMessage('Barcode field copied.');
        break;
      case 'export-png':
        await savePng(message.data ?? [], message.name ?? 'barcode.png');
        break;
      case 'error':
        void vscode.window.showErrorMessage(
          message.message ?? 'Barcode studio error.',
        );
        break;
      default:
        break;
    }
  }

  private dispose(): void {
    BarcodeStudioPanel.current = undefined;
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.panel.dispose();
  }
}

async function insertSnippet(snippet: string): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    await vscode.env.clipboard.writeText(snippet);
    void vscode.window.showInformationMessage(
      'No editor is open — the barcode field was copied to the clipboard instead.',
    );
    return;
  }
  await editor.insertSnippet(
    new vscode.SnippetString(snippet.replace(/\$/g, '\\$') + '\n'),
  );
}

async function savePng(data: number[], name: string): Promise<void> {
  const target = await vscode.window.showSaveDialog({
    filters: { 'PNG Image': ['png'] },
    defaultUri: vscode.Uri.file(name),
  });
  if (!target) {
    return;
  }
  await vscode.workspace.fs.writeFile(target, new Uint8Array(data));
  void vscode.window.showInformationMessage(`Barcode saved to ${target.fsPath}`);
}
