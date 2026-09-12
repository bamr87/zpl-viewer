import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { LABEL_ACTIONS } from '../../ui/commands';
import {
  ActionsProvider,
  DataSourcesProvider,
  LabelFilesProvider,
  PrintersProvider,
  TemplatesProvider,
} from '../../ui/labelExplorer';

interface MenuEntry {
  command?: string;
  submenu?: string;
  when?: string;
  group?: string;
}

interface Manifest {
  contributes: {
    commands: Array<{ command: string; title: string; icon?: string }>;
    menus: Record<string, MenuEntry[]>;
    submenus?: Array<{ id: string; label: string }>;
    views: Record<string, Array<{ id: string; name: string }>>;
    viewsWelcome?: Array<{ view: string; contents: string }>;
  };
}

function manifest(): Manifest {
  const extension = vscode.extensions.getExtension('zpl-viewer.zpl-viewer');
  expect(extension, 'extension not found').to.not.equal(undefined);
  return extension!.packageJSON as Manifest;
}

/**
 * The UI surfaces are declared in package.json and implemented in TypeScript,
 * and nothing but a test connects the two: VS Code silently ignores a menu
 * entry pointing at a command that was never registered, so a typo there is
 * invisible until a user clicks the item and nothing happens.
 */
describe('integration: UI surfaces', () => {
  before(async () => {
    // These assertions are about what activation registers, so they must not
    // depend on another suite having opened a label first.
    const extension = vscode.extensions.getExtension('zpl-viewer.zpl-viewer');
    if (extension && !extension.isActive) {
      await extension.activate();
    }
  });

  it('registers every command the manifest declares', async () => {
    const registered = new Set(await vscode.commands.getCommands(true));
    const missing = manifest()
      .contributes.commands.map((entry) => entry.command)
      .filter((command) => !registered.has(command));
    expect(missing, 'declared but never registered').to.deep.equal([]);
  });

  it('registers every command any menu points at', async () => {
    const registered = new Set(await vscode.commands.getCommands(true));
    const missing: string[] = [];
    for (const [menu, entries] of Object.entries(manifest().contributes.menus)) {
      for (const entry of entries) {
        if (entry.command && !registered.has(entry.command)) {
          missing.push(`${menu} → ${entry.command}`);
        }
      }
    }
    expect(missing, 'menu entries with no command behind them').to.deep.equal([]);
  });

  it('declares every submenu a menu references', () => {
    const contributes = manifest().contributes;
    const declared = new Set((contributes.submenus ?? []).map((entry) => entry.id));
    const referenced: string[] = [];
    for (const entries of Object.values(contributes.menus)) {
      for (const entry of entries) {
        if (entry.submenu && !declared.has(entry.submenu)) {
          referenced.push(entry.submenu);
        }
      }
    }
    expect(referenced, 'submenus referenced but not declared').to.deep.equal([]);

    // And every declared submenu is actually populated — an empty one renders
    // as a dead end in the context menu.
    for (const submenu of contributes.submenus ?? []) {
      expect(
        contributes.menus[submenu.id]?.length ?? 0,
        `submenu ${submenu.id} has no items`,
      ).to.be.greaterThan(0);
    }
  });

  it('surfaces the extension in the activity bar, editor and explorer', () => {
    const menus = manifest().contributes.menus;
    // Each of these is a different way into the extension; losing one sends
    // users back to the command palette, which is what this work removed.
    for (const surface of [
      'view/title',
      'view/item/context',
      'editor/title',
      'editor/context',
      'explorer/context',
    ]) {
      expect(menus[surface]?.length ?? 0, `no entries in ${surface}`).to.be.greaterThan(0);
    }

    const views = manifest().contributes.views.labelStudio.map((view) => view.id);
    expect(views).to.include.members([
      'labelStudio.actionsView',
      'labelStudio.labelsView',
      'labelStudio.dataView',
      'labelStudio.printersView',
      'labelStudio.templatesView',
    ]);
  });

  it('offers welcome content for the views that can be empty', () => {
    const welcome = (manifest().contributes.viewsWelcome ?? []).map((entry) => entry.view);
    // A tree that can legitimately have nothing in it needs to say what to do
    // about that; the Actions and Templates trees are never empty.
    expect(welcome).to.include.members([
      'labelStudio.labelsView',
      'labelStudio.dataView',
      'labelStudio.printersView',
    ]);
  });

  it('builds an Actions tree whose every command is registered', async () => {
    const registered = new Set(await vscode.commands.getCommands(true));
    const provider = new ActionsProvider();

    const groups = provider.getChildren();
    expect(groups.length, 'action groups').to.be.greaterThan(0);

    let actions = 0;
    for (const group of groups) {
      expect(group.kind).to.equal('group');
      for (const action of provider.getChildren(group)) {
        expect(action.kind).to.equal('action');
        expect(action.command, `${action.label} has no command`).to.not.equal(undefined);
        expect(
          registered.has(action.command!),
          `Actions tree offers unregistered ${action.command}`,
        ).to.equal(true);
        // The tree renders an icon, so the `$(…)` prefix must have been split
        // off the quick-pick label rather than shown as literal text.
        expect(action.label).to.not.match(/^\$\(/);
        actions += 1;
      }
    }
    expect(actions, 'actions in the tree').to.be.greaterThan(10);
    provider.dispose();
  });

  it('gives tree items the contextValue its menus match on', async () => {
    // `when: viewItem == labelFile` matches a TreeItem's contextValue. Nothing
    // enforces that the two agree, and when they disagree the menu entry simply
    // never appears — no error, no log, just a missing feature.
    const produced = new Set<string>();

    const labels = new LabelFilesProvider();
    for (const group of await labels.getChildren()) {
      produced.add(String(labels.getTreeItem(group).contextValue));
      for (const file of await labels.getChildren(group)) {
        produced.add(String(labels.getTreeItem(file).contextValue));
      }
    }
    labels.dispose();

    const data = new DataSourcesProvider();
    for (const node of await data.getChildren()) {
      produced.add(String(data.getTreeItem(node).contextValue));
    }
    data.dispose();

    const templates = new TemplatesProvider();
    for (const node of templates.getChildren()) {
      produced.add(String(templates.getTreeItem(node).contextValue));
    }
    templates.dispose();

    // The fixture workspace configures no printers, so exercise the item
    // renderer directly rather than skipping the view entirely.
    const printers = new PrintersProvider();
    produced.add(
      String(
        printers.getTreeItem({
          name: 'Test',
          transport: 'tcp',
          host: '127.0.0.1',
          port: 9100,
          format: 'zpl',
          dpmm: 8,
        }).contextValue,
      ),
    );
    printers.dispose();

    const actions = new ActionsProvider();
    for (const group of actions.getChildren()) {
      produced.add(String(actions.getTreeItem(group).contextValue));
      for (const action of actions.getChildren(group)) {
        produced.add(String(actions.getTreeItem(action).contextValue));
      }
    }
    actions.dispose();

    const referenced = new Set<string>();
    for (const entry of manifest().contributes.menus['view/item/context'] ?? []) {
      const match = /viewItem\s*==\s*([A-Za-z0-9_]+)/.exec(entry.when ?? '');
      if (match) {
        referenced.add(match[1]);
      }
    }
    expect(referenced.size, 'menus keyed on a viewItem').to.be.greaterThan(0);

    const unmatched = [...referenced].filter((value) => !produced.has(value));
    expect(unmatched, 'menu when-clauses no tree item can satisfy').to.deep.equal([]);
  });

  it('keeps the action catalog pointed at real commands', async () => {
    const registered = new Set(await vscode.commands.getCommands(true));
    const missing = LABEL_ACTIONS.map((action) => action.command).filter(
      (command) => !registered.has(command),
    );
    expect(missing, 'catalog entries with no command').to.deep.equal([]);
  });
});

describe('integration: commands act on the target they are given', () => {
  let saveDialogStub: sinon.SinonStub | undefined;
  let infoStub: sinon.SinonStub;

  beforeEach(() => {
    infoStub = sinon.stub(vscode.window, 'showInformationMessage').resolves(undefined as never);
  });

  afterEach(() => {
    saveDialogStub?.restore();
    saveDialogStub = undefined;
    infoStub.restore();
  });

  it('exports the label passed from a tree item, not the active editor', async () => {
    // This is what makes the sidebar useful: clicking a label in the Labels
    // view has to act on *that* label even though the editor is showing
    // something else entirely.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zpl-viewer-ui-'));
    const activePath = path.join(dir, 'active.zpl');
    const targetPath = path.join(dir, 'target.zpl');
    fs.writeFileSync(activePath, '^XA^CF0,40^FO20,20^FDACTIVE EDITOR^FS^XZ\n');
    fs.writeFileSync(targetPath, '^XA^CF0,40^FO20,20^FDTREE TARGET^FS^XZ\n');

    const active = await vscode.workspace.openTextDocument(vscode.Uri.file(activePath));
    await vscode.window.showTextDocument(active);

    const out = vscode.Uri.file(path.join(dir, 'out.svg'));
    saveDialogStub = sinon.stub(vscode.window, 'showSaveDialog').resolves(out);

    // A tree node, exactly as a view/item/context menu would hand it over.
    await vscode.commands.executeCommand('labelStudio.exportSvg', {
      resourceUri: vscode.Uri.file(targetPath),
    });

    const svg = fs.readFileSync(out.fsPath, 'utf8');
    expect(svg).to.contain('TREE TARGET');
    expect(svg).to.not.contain('ACTIVE EDITOR');
  });

  it('falls back to the active editor when handed no target', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zpl-viewer-ui-'));
    const activePath = path.join(dir, 'only.zpl');
    fs.writeFileSync(activePath, '^XA^CF0,40^FO20,20^FDFALLBACK^FS^XZ\n');
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(activePath));
    await vscode.window.showTextDocument(document);

    const out = vscode.Uri.file(path.join(dir, 'out.svg'));
    saveDialogStub = sinon.stub(vscode.window, 'showSaveDialog').resolves(out);

    await vscode.commands.executeCommand('labelStudio.exportSvg');

    expect(fs.readFileSync(out.fsPath, 'utf8')).to.contain('FALLBACK');
  });

  it('ignores a printer node where a label is expected', async () => {
    // `labelStudio.deploy` is reachable from both the Printers view (which
    // names a printer) and a label. A printer node must not be mistaken for a
    // label to deploy.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zpl-viewer-ui-'));
    const labelPath = path.join(dir, 'deploy-me.zpl');
    fs.writeFileSync(labelPath, '^XA^FO20,20^FDDEPLOY^FS^XZ\n');
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(labelPath));
    await vscode.window.showTextDocument(document);

    const warnStub = sinon
      .stub(vscode.window, 'showWarningMessage')
      .resolves(undefined as never);
    try {
      // No printers are configured in the fixture workspace, so the command
      // should ask to add one rather than complain about the label.
      await vscode.commands.executeCommand('labelStudio.deploy', {
        name: 'Warehouse ZT411',
        transport: 'tcp',
      });
      const messages = warnStub.getCalls().map((call) => String(call.args[0]));
      expect(
        messages.some((message) => message.includes('No printers are configured')),
        `unexpected warnings: ${messages.join(' | ')}`,
      ).to.equal(true);
    } finally {
      warnStub.restore();
    }
  });
});
