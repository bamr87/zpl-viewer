/**
 * The Label Studio activity-bar views — the "manage" half of the extension.
 *
 * Four trees: the label files in the workspace grouped by printer language,
 * the data sources available to merge against them, the configured printers,
 * and the starter templates.
 */

import * as vscode from 'vscode';
import {
  LABEL_FORMATS,
  LabelFormatId,
  detectFormat,
  formatForFileName,
  labelFileExtensions,
} from '../core/formats';
import { LABEL_TEMPLATES, LabelTemplate } from '../core/templates';
import { PrinterProfile, describePrinter, validatePrinter } from '../deploy/printers';
import { getPrinters } from '../config';

const LABEL_GLOB = `**/*.{${labelFileExtensions()
  .map((extension) => extension.slice(1))
  .join(',')}}`;
const DATA_GLOB = '**/*.{csv,tsv,psv,json,jsonl,ndjson}';
const EXCLUDE_GLOB = '**/{node_modules,out,dist,.git}/**';

abstract class RefreshableProvider<T> implements vscode.TreeDataProvider<T> {
  private readonly emitter = new vscode.EventEmitter<T | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;

  refresh(): void {
    this.emitter.fire(undefined);
  }

  dispose(): void {
    this.emitter.dispose();
  }

  abstract getTreeItem(element: T): vscode.TreeItem;
  abstract getChildren(element?: T): vscode.ProviderResult<T[]>;
}

export interface LabelFileNode {
  kind: 'format' | 'file';
  label: string;
  format: LabelFormatId;
  uri?: vscode.Uri;
}

export class LabelFilesProvider extends RefreshableProvider<LabelFileNode> {
  getTreeItem(element: LabelFileNode): vscode.TreeItem {
    if (element.kind === 'format') {
      const item = new vscode.TreeItem(
        element.label,
        vscode.TreeItemCollapsibleState.Expanded,
      );
      item.contextValue = 'labelFormatGroup';
      item.iconPath = new vscode.ThemeIcon('symbol-namespace');
      return item;
    }
    const item = new vscode.TreeItem(
      element.label,
      vscode.TreeItemCollapsibleState.None,
    );
    item.resourceUri = element.uri;
    item.contextValue = 'labelFile';
    item.iconPath = new vscode.ThemeIcon('tag');
    item.description = element.format.toUpperCase();
    item.command = {
      command: 'vscode.open',
      title: 'Open label',
      arguments: [element.uri],
    };
    return item;
  }

  async getChildren(element?: LabelFileNode): Promise<LabelFileNode[]> {
    const files = await vscode.workspace.findFiles(LABEL_GLOB, EXCLUDE_GLOB, 500);
    const classified = await Promise.all(
      files.map(async (uri) => ({
        uri,
        format: await formatOfFile(uri),
      })),
    );

    if (!element) {
      const present = new Set(classified.map((entry) => entry.format));
      return [...present].sort().map((format) => ({
        kind: 'format' as const,
        label: `${LABEL_FORMATS[format].label} (${classified.filter((entry) => entry.format === format).length})`,
        format,
      }));
    }
    if (element.kind !== 'format') {
      return [];
    }
    return classified
      .filter((entry) => entry.format === element.format)
      .map((entry) => ({
        kind: 'file' as const,
        label: vscode.workspace.asRelativePath(entry.uri),
        format: entry.format,
        uri: entry.uri,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }
}

async function formatOfFile(uri: vscode.Uri): Promise<LabelFormatId> {
  const byName = formatForFileName(uri.fsPath);
  if (byName) {
    return byName;
  }
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    return detectFormat(
      Buffer.from(bytes.subarray(0, 4096)).toString('utf8'),
      uri.fsPath,
    );
  } catch {
    return 'zpl';
  }
}

export interface DataSourceNode {
  uri: vscode.Uri;
  label: string;
}

export class DataSourcesProvider extends RefreshableProvider<DataSourceNode> {
  getTreeItem(element: DataSourceNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      element.label,
      vscode.TreeItemCollapsibleState.None,
    );
    item.resourceUri = element.uri;
    item.contextValue = 'dataSource';
    item.iconPath = new vscode.ThemeIcon('table');
    item.command = {
      command: 'labelStudio.previewDataSource',
      title: 'Preview data source',
      arguments: [element.uri],
    };
    return item;
  }

  async getChildren(element?: DataSourceNode): Promise<DataSourceNode[]> {
    if (element) {
      return [];
    }
    const files = await vscode.workspace.findFiles(DATA_GLOB, EXCLUDE_GLOB, 300);
    return files
      .map((uri) => ({ uri, label: vscode.workspace.asRelativePath(uri) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }
}

export class PrintersProvider extends RefreshableProvider<PrinterProfile> {
  getTreeItem(element: PrinterProfile): vscode.TreeItem {
    const item = new vscode.TreeItem(
      element.name,
      vscode.TreeItemCollapsibleState.None,
    );
    const problems = validatePrinter(element);
    item.description = describePrinter(element);
    item.tooltip = new vscode.MarkdownString(
      [
        `**${element.name}**`,
        '',
        element.description ?? '',
        '',
        `- Transport: \`${element.transport}\``,
        `- Language: \`${element.format.toUpperCase()}\``,
        `- Density: ${element.dpmm} dpmm`,
        ...problems.map((problem) => `- ⚠ ${problem}`),
      ].join('\n'),
    );
    item.contextValue = 'printer';
    item.iconPath = new vscode.ThemeIcon(
      problems.length > 0 ? 'warning' : 'device-desktop',
    );
    item.command = {
      command: 'labelStudio.deploy',
      title: 'Deploy to printer',
      arguments: [element.name],
    };
    return item;
  }

  getChildren(element?: PrinterProfile): PrinterProfile[] {
    return element ? [] : getPrinters();
  }
}

export class TemplatesProvider extends RefreshableProvider<LabelTemplate> {
  getTreeItem(element: LabelTemplate): vscode.TreeItem {
    const item = new vscode.TreeItem(
      element.label,
      vscode.TreeItemCollapsibleState.None,
    );
    item.description = `${element.format.toUpperCase()} · ${element.widthInches}x${element.heightInches}"`;
    item.tooltip = new vscode.MarkdownString(
      [
        `**${element.label}**`,
        '',
        element.description,
        '',
        element.placeholders.length > 0
          ? `Fields: ${element.placeholders.map((p) => `\`{{${p}}}\``).join(', ')}`
          : '',
      ].join('\n'),
    );
    item.contextValue = 'labelTemplate';
    item.iconPath = new vscode.ThemeIcon('file-code');
    item.command = {
      command: 'labelStudio.newFromTemplate',
      title: 'New label from template',
      arguments: [element.id],
    };
    return item;
  }

  getChildren(element?: LabelTemplate): LabelTemplate[] {
    return element ? [] : LABEL_TEMPLATES;
  }
}

export interface LabelExplorer extends vscode.Disposable {
  refresh(): void;
}

/** Registers every tree view and keeps them in sync with the workspace. */
export function registerLabelExplorer(
  context: vscode.ExtensionContext,
): LabelExplorer {
  const labels = new LabelFilesProvider();
  const data = new DataSourcesProvider();
  const printers = new PrintersProvider();
  const templates = new TemplatesProvider();

  const disposables: vscode.Disposable[] = [
    vscode.window.createTreeView('labelStudio.labelsView', {
      treeDataProvider: labels,
      showCollapseAll: true,
    }),
    vscode.window.createTreeView('labelStudio.dataView', {
      treeDataProvider: data,
    }),
    vscode.window.createTreeView('labelStudio.printersView', {
      treeDataProvider: printers,
    }),
    vscode.window.createTreeView('labelStudio.templatesView', {
      treeDataProvider: templates,
    }),
    labels,
    data,
    printers,
    templates,
  ];

  const labelWatcher = vscode.workspace.createFileSystemWatcher(LABEL_GLOB);
  const dataWatcher = vscode.workspace.createFileSystemWatcher(DATA_GLOB);
  disposables.push(
    labelWatcher,
    dataWatcher,
    labelWatcher.onDidCreate(() => labels.refresh()),
    labelWatcher.onDidDelete(() => labels.refresh()),
    dataWatcher.onDidCreate(() => data.refresh()),
    dataWatcher.onDidDelete(() => data.refresh()),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      labels.refresh();
      data.refresh();
    }),
  );

  context.subscriptions.push(...disposables);

  return {
    refresh(): void {
      labels.refresh();
      data.refresh();
      printers.refresh();
      templates.refresh();
    },
    dispose(): void {
      for (const disposable of disposables) {
        disposable.dispose();
      }
    },
  };
}
