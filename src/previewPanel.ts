import * as vscode from 'vscode';
import { isLabelFormatId } from './core/formats';
import {
  affectsLabelStudio,
  formatOfDocument,
  getPreviewConfig,
  getRenderConfig,
} from './config';
import { renderWebviewHtml } from './ui/webviewHtml';
import { parsePreviewMessage } from './ui/webviewGuards';

export { getRenderConfig };

/**
 * Manages the local-rendering preview webview. The webview owns the canvas
 * renderer; this class is a thin host that:
 *   - Loads the bundled preview HTML/JS from disk.
 *   - Pushes the current document text (+ render options) to the webview.
 *   - Forwards export requests to the webview and writes the returned bytes.
 */
export class LabelPreviewManager {
  private readonly panels = new Map<string, LabelPreviewPanel>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly output: vscode.OutputChannel;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.output = vscode.window.createOutputChannel('Label Studio');
    this.disposables.push(this.output);
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => this.onDocumentChanged(e)),
      vscode.workspace.onDidCloseTextDocument((doc) => {
        const panel = this.panels.get(doc.uri.toString());
        if (panel) {
          panel.dispose();
        }
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (affectsLabelStudio(e)) {
          const zoomChanged = affectsLabelStudio(e, 'preview.initialZoom');
          for (const panel of this.panels.values()) {
            if (zoomChanged) {
              panel.resetZoom();
            }
            void panel.refresh();
          }
        }
      }),
    );
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
    for (const panel of this.panels.values()) {
      panel.dispose();
    }
    this.panels.clear();
  }

  show(document: vscode.TextDocument, toSide: boolean): void {
    const key = document.uri.toString();
    const existing = this.panels.get(key);
    const viewColumn = toSide ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active;
    if (existing) {
      existing.reveal(viewColumn);
      void existing.refresh();
      return;
    }
    const panel = new LabelPreviewPanel(
      this.context,
      document,
      viewColumn,
      this.output,
      () => {
        this.panels.delete(key);
      },
    );
    this.panels.set(key, panel);
  }

  refreshActive(): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }
    const panel = this.panels.get(editor.document.uri.toString());
    if (panel) {
      void panel.refresh();
    }
  }

  /**
   * Exports the active editor's label by piping the document through the
   * preview webview. If no preview is currently open, one is opened to the
   * side and left in place (VS Code has no true "hidden" webview).
   */
  async export(
    document: vscode.TextDocument,
    format: 'png' | 'pdf',
    pageIndex?: number,
  ): Promise<Uint8Array> {
    const key = document.uri.toString();
    let panel = this.panels.get(key);
    if (!panel) {
      panel = new LabelPreviewPanel(
        this.context,
        document,
        vscode.ViewColumn.Beside,
        this.output,
        () => {
          this.panels.delete(key);
        },
      );
      this.panels.set(key, panel);
    }
    return panel.exportBytes(format, pageIndex);
  }

  /** The label the document's open preview is showing, or `undefined` when none is open. */
  currentPage(document: vscode.TextDocument): number | undefined {
    return this.panels.get(document.uri.toString())?.currentPage;
  }

  async waitForReady(
    uri: vscode.Uri,
    timeoutMs = 10000,
  ): Promise<void> {
    if (process.env.VSCODE_ZPL_TEST !== '1') {
      throw new Error('waitForReady is only available in test mode.');
    }
    const panel = this.panels.get(uri.toString());
    if (!panel) {
      throw new Error(`No preview panel found for ${uri.toString()}.`);
    }
    await Promise.race([
      panel.waitForReady(),
      new Promise<void>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Preview did not become ready in ${timeoutMs}ms.`)),
          timeoutMs,
        ),
      ),
    ]);
  }

  private onDocumentChanged(e: vscode.TextDocumentChangeEvent): void {
    if (!isLabelFormatId(e.document.languageId)) {
      return;
    }
    const panel = this.panels.get(e.document.uri.toString());
    if (!panel) {
      return;
    }
    const preview = getPreviewConfig();
    if (!preview.autoRefresh) {
      return;
    }
    panel.scheduleRefresh(preview.autoRefreshDelay);
  }
}

class LabelPreviewPanel {
  private readonly panel: vscode.WebviewPanel;
  private refreshTimer: NodeJS.Timeout | undefined;
  /**
   * What the webview last reported it is showing. Sent back on every refresh so
   * an edit, a settings change or the Refresh button does not snap the preview
   * to label 1 and the initial zoom. Unset until the webview reports, so the
   * first render (and only the first) uses `preview.initialZoom`.
   */
  private viewState: { page: number; scale: number } | undefined;
  private disposed = false;
  private readyPromise: Promise<void>;
  private resolveReady!: () => void;
  private pendingExports = new Map<
    string,
    { resolve: (bytes: Uint8Array) => void; reject: (err: Error) => void }
  >();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly document: vscode.TextDocument,
    column: vscode.ViewColumn,
    private readonly output: vscode.OutputChannel,
    private readonly onDispose: () => void,
  ) {
    this.panel = vscode.window.createWebviewPanel(
      'labelStudio.preview',
      `Preview: ${this.shortName()}`,
      { viewColumn: column, preserveFocus: true },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview'),
        ],
      },
    );
    this.panel.onDidDispose(() => this.dispose());
    this.panel.webview.onDidReceiveMessage((m) => this.handleMessage(m));
    this.readyPromise = new Promise<void>((resolve) => {
      this.resolveReady = resolve;
    });
    this.output.appendLine(
      `[preview] opening panel for ${this.document.uri.fsPath}`,
    );
    this.panel.webview.html = this.buildHtml();
    setTimeout(() => {
      if (!this.disposed && !this.isReady) {
        this.output.appendLine(
          `[preview] webview has not reported ready after 5s; the bundled script may have failed to load.`,
        );
        this.output.show(true);
      }
    }, 5000);
    void this.refresh();
  }

  private isReady = false;

  reveal(column: vscode.ViewColumn): void {
    this.panel.reveal(column, true);
  }

  waitForReady(): Promise<void> {
    return this.readyPromise;
  }

  /** Forgets the reported zoom, so the next render uses `preview.initialZoom` again. */
  resetZoom(): void {
    if (this.viewState) {
      this.viewState = { ...this.viewState, scale: getRenderConfig().scale };
    }
  }

  /** Zero-based index of the label the preview is showing. */
  get currentPage(): number | undefined {
    return this.viewState?.page;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    for (const pending of this.pendingExports.values()) {
      pending.reject(new Error('Preview disposed before export completed.'));
    }
    this.pendingExports.clear();
    this.panel.dispose();
    this.onDispose();
  }

  scheduleRefresh(delay: number): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      void this.refresh();
    }, delay);
  }

  async refresh(): Promise<void> {
    if (this.disposed) {
      return;
    }
    await this.readyPromise;
    if (this.disposed) {
      return;
    }
    const cfg = getRenderConfig();
    const chars = this.document.getText().length;
    this.output.appendLine(
      `[preview] posting render (${chars} chars, ${cfg.dpmm}dpmm, ${cfg.widthInches}x${cfg.heightInches}")`,
    );
    this.panel.webview.postMessage({
      type: 'render',
      source: this.document.getText(),
      format: formatOfDocument(this.document),
      options: { ...cfg, scale: this.viewState?.scale ?? cfg.scale },
      pageIndex: this.viewState?.page ?? 0,
    });
  }

  async exportBytes(
    format: 'png' | 'pdf',
    pageIndex?: number,
  ): Promise<Uint8Array> {
    await this.readyPromise;
    const cfg = getRenderConfig();
    const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const promise = new Promise<Uint8Array>((resolve, reject) => {
      this.pendingExports.set(requestId, { resolve, reject });
      setTimeout(() => {
        if (this.pendingExports.has(requestId)) {
          this.pendingExports.delete(requestId);
          reject(new Error('Export timed out.'));
        }
      }, 20000);
    });
    this.panel.webview.postMessage({
      type: 'export',
      format,
      labelFormat: formatOfDocument(this.document),
      requestId,
      pageIndex: pageIndex ?? this.viewState?.page ?? 0,
      source: this.document.getText(),
      options: {
        dpmm: cfg.dpmm,
        widthInches: cfg.widthInches,
        heightInches: cfg.heightInches,
      },
    });
    return promise;
  }

  private handleMessage(raw: unknown): void {
    const msg = parsePreviewMessage(raw);
    if (!msg) {
      const type = (raw as { type?: unknown } | null)?.type;
      this.output.appendLine(`[preview] refused message ${JSON.stringify(type ?? null)}`);
      return;
    }
    switch (msg.type) {
      case 'run-command': {
        // The preview's toolbar runs host commands, so the buttons there stay
        // the same actions as the menus — and it passes its own document, since
        // clicking inside a webview leaves no active text editor to fall back
        // to.
        // parsePreviewMessage already refused anything outside the toolbar's
        // allowlist, so Deploy is out of reach from here.
        void vscode.commands.executeCommand(msg.command, this.document.uri);
        break;
      }
      case 'ready':
        this.isReady = true;
        this.output.appendLine('[preview] webview ready');
        this.resolveReady();
        break;
      case 'refresh-request':
        void this.refresh();
        break;
      case 'view-state':
        this.viewState = { page: msg.page, scale: msg.scale };
        break;
      case 'log': {
        const level = msg.level.toUpperCase();
        this.output.appendLine(`[preview:${level}] ${msg.message}`);
        if (msg.detail) {
          this.output.appendLine(msg.detail);
        }
        if (level === 'ERROR') {
          this.output.show(true);
        }
        break;
      }
      case 'export-result': {
        const req = this.pendingExports.get(msg.requestId);
        if (req) {
          req.resolve(new Uint8Array(msg.data));
          this.pendingExports.delete(msg.requestId);
        }
        break;
      }
      case 'export-error': {
        const req = this.pendingExports.get(msg.requestId);
        if (req) {
          req.reject(new Error(msg.error));
          this.pendingExports.delete(msg.requestId);
        }
        break;
      }
      default:
        break;
    }
  }

  private buildHtml(): string {
    return renderWebviewHtml(
      this.panel.webview,
      this.context.extensionUri,
      'preview.html',
      'preview.js',
    );
  }

  private shortName(): string {
    const parts = this.document.uri.path.split('/');
    return parts[parts.length - 1] || 'Label';
  }
}

