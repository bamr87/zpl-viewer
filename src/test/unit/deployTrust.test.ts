import { expect } from 'chai';
import * as path from 'path';
import {
  confirmationMessage,
  needsConfirmation,
  resolveTargetPath,
  settingOrigin,
} from '../../deploy/trust';

describe('deploy.trust.needsConfirmation', () => {
  it('always confirms a workspace-defined printer, even with confirmBeforeSend off', () => {
    expect(needsConfirmation({ origin: 'workspace', confirmSetting: false, dryRun: false })).to.equal(true);
    expect(needsConfirmation({ origin: 'workspaceFolder', confirmSetting: false, dryRun: false })).to.equal(true);
  });

  it('lets the user turn confirmation off for their own printers', () => {
    expect(needsConfirmation({ origin: 'user', confirmSetting: false, dryRun: false })).to.equal(false);
    expect(needsConfirmation({ origin: 'user', confirmSetting: true, dryRun: false })).to.equal(true);
  });

  it('never confirms a dry run, which sends nothing', () => {
    expect(needsConfirmation({ origin: 'workspace', confirmSetting: true, dryRun: true })).to.equal(false);
    expect(needsConfirmation({ origin: 'user', confirmSetting: true, dryRun: true })).to.equal(false);
  });
});

describe('deploy.trust.settingOrigin', () => {
  it('reports the most specific layer that is set', () => {
    expect(settingOrigin({ globalValue: [], workspaceValue: [] })).to.equal('workspace');
    expect(settingOrigin({ workspaceFolderValue: [], workspaceValue: [] })).to.equal('workspaceFolder');
    expect(settingOrigin({ globalValue: [] })).to.equal('user');
    expect(settingOrigin({})).to.equal('default');
    expect(settingOrigin(undefined)).to.equal('default');
  });
});

describe('deploy.trust.resolveTargetPath', () => {
  const folder = path.resolve('/work/labels');

  it('resolves a relative path against the first workspace folder', () => {
    const resolved = resolveTargetPath({ transport: 'file', path: 'out/label.zpl' }, [folder]);
    expect(resolved).to.deep.equal({
      absolutePath: path.join(folder, 'out', 'label.zpl'),
      insideWorkspace: true,
    });
  });

  it('reports an absolute path outside every folder as outside the workspace', () => {
    const resolved = resolveTargetPath({ transport: 'file', path: '/tmp/x' }, [folder]);
    expect(resolved?.absolutePath).to.equal(path.resolve('/tmp/x'));
    expect(resolved?.insideWorkspace).to.equal(false);
  });

  it('reports <folder>/out/label.zpl as inside the workspace', () => {
    const resolved = resolveTargetPath(
      { transport: 'directory', path: path.join(folder, 'out', 'label.zpl') },
      [folder],
    );
    expect(resolved?.insideWorkspace).to.equal(true);
  });

  it('does not let ../ climb out of the workspace', () => {
    const resolved = resolveTargetPath({ transport: 'file', path: '../../etc/x' }, [folder]);
    expect(resolved?.insideWorkspace).to.equal(false);
    const sibling = resolveTargetPath({ transport: 'file', path: `${folder}-evil/x` }, [folder]);
    expect(sibling?.insideWorkspace).to.equal(false);
  });

  it('treats a path as outside when no folder is open', () => {
    expect(resolveTargetPath({ transport: 'file', path: '/tmp/x' }, [])?.insideWorkspace).to.equal(false);
  });

  it('ignores TCP printers', () => {
    expect(resolveTargetPath({ transport: 'tcp', path: undefined }, [folder])).to.equal(undefined);
  });
});

describe('deploy.trust.confirmationMessage', () => {
  it('names the workspace origin, the transport and the resolved target', () => {
    const resolved = { absolutePath: '/tmp/x', insideWorkspace: false };
    const text = confirmationMessage({
      profile: { name: 'Evil', transport: 'file', port: 9100, path: 'x' },
      origin: 'workspace',
      labelCount: 1,
      resolved,
    });
    expect(text).to.contain('defined by this workspace');
    expect(text).to.contain('file');
    expect(text).to.contain('/tmp/x');
    expect(text).to.contain('outside this workspace');
  });

  it('stays the plain question for the user\'s own TCP printer', () => {
    const text = confirmationMessage({
      profile: { name: 'ZT411', transport: 'tcp', host: '10.0.0.5', port: 9100 },
      origin: 'user',
      labelCount: 2,
    });
    expect(text).to.equal('Send 2 label(s) to ZT411 over tcp → 10.0.0.5:9100?');
  });
});
