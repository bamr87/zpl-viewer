import { expect } from 'chai';
import {
  generateNonce,
  isAllowedPreviewCommand,
  parsePreviewMessage,
  parseStudioMessage,
} from '../../ui/webviewGuards';

describe('webviewGuards.generateNonce', () => {
  it('returns at least 22 base64 characters', () => {
    const nonce = generateNonce();
    expect(nonce).to.match(/^[A-Za-z0-9+/]{22,}={0,2}$/);
  });

  it('differs between calls', () => {
    expect(generateNonce()).to.not.equal(generateNonce());
  });
});

describe('webviewGuards.parsePreviewMessage', () => {
  it('accepts the commands the preview toolbar sends', () => {
    for (const command of [
      'labelStudio.exportPng',
      'labelStudio.exportPdf',
      'labelStudio.exportSvg',
      'labelStudio.showActions',
      'labelStudio.refreshPreview',
    ]) {
      expect(parsePreviewMessage({ type: 'run-command', command })).to.deep.equal({
        type: 'run-command',
        command,
      });
    }
  });

  it('accepts a view-state report and refuses a malformed one', () => {
    expect(parsePreviewMessage({ type: 'view-state', page: 2, scale: 1.5 })).to.deep.equal({
      type: 'view-state',
      page: 2,
      scale: 1.5,
    });
    for (const bad of [
      { type: 'view-state', page: -1, scale: 1 },
      { type: 'view-state', page: 1.5, scale: 1 },
      { type: 'view-state', page: 0, scale: 0 },
      { type: 'view-state', page: 0, scale: Infinity },
      { type: 'view-state', page: 0, scale: 1000 },
      { type: 'view-state', page: '1', scale: 1 },
      { type: 'view-state' },
    ]) {
      expect(parsePreviewMessage(bad), JSON.stringify(bad)).to.equal(undefined);
    }
  });

  it('refuses Deploy and any other labelStudio command off the allowlist', () => {
    expect(parsePreviewMessage({ type: 'run-command', command: 'labelStudio.deploy' })).to.equal(undefined);
    expect(parsePreviewMessage({ type: 'run-command', command: 'labelStudio.deployDryRun' })).to.equal(undefined);
    expect(parsePreviewMessage({ type: 'run-command', command: 'workbench.action.terminal.new' })).to.equal(undefined);
    expect(parsePreviewMessage({ type: 'run-command' })).to.equal(undefined);
    expect(isAllowedPreviewCommand('labelStudio.deploy')).to.equal(false);
    expect(isAllowedPreviewCommand('labelStudio.exportPng')).to.equal(true);
  });

  it('rejects an export result whose data is not a byte array', () => {
    expect(parsePreviewMessage({ type: 'export-result', requestId: 'r1', data: 'x' })).to.equal(undefined);
    expect(parsePreviewMessage({ type: 'export-result', requestId: 'r1', data: [1, 256] })).to.equal(undefined);
    expect(parsePreviewMessage({ type: 'export-result', data: [1, 2] })).to.equal(undefined);
    expect(parsePreviewMessage({ type: 'export-result', requestId: 'r1', data: [1, 2] })).to.deep.equal({
      type: 'export-result',
      requestId: 'r1',
      data: [1, 2],
    });
  });

  it('rejects unknown types and non-object messages', () => {
    expect(parsePreviewMessage({ type: 'eval', code: '1' })).to.equal(undefined);
    expect(parsePreviewMessage(null)).to.equal(undefined);
    expect(parsePreviewMessage('ready')).to.equal(undefined);
    expect(parsePreviewMessage({})).to.equal(undefined);
  });

  it('fills defaults for the messages the host already handled loosely', () => {
    expect(parsePreviewMessage({ type: 'ready' })).to.deep.equal({ type: 'ready' });
    expect(parsePreviewMessage({ type: 'log', message: 'hi' })).to.deep.equal({
      type: 'log',
      level: 'info',
      message: 'hi',
    });
    expect(parsePreviewMessage({ type: 'log', message: 42 })).to.equal(undefined);
    expect(parsePreviewMessage({ type: 'export-error', requestId: 'r1' })).to.deep.equal({
      type: 'export-error',
      requestId: 'r1',
      error: 'Unknown export error.',
    });
  });
});

describe('webviewGuards.parseStudioMessage', () => {
  it('accepts the studio messages with their payloads', () => {
    expect(parseStudioMessage({ type: 'insert', snippet: '^BCN' })).to.deep.equal({ type: 'insert', snippet: '^BCN' });
    expect(parseStudioMessage({ type: 'export-png', data: [137, 80] })).to.deep.equal({
      type: 'export-png',
      data: [137, 80],
      name: 'barcode.png',
    });
  });

  it('rejects malformed payloads', () => {
    expect(parseStudioMessage({ type: 'insert' })).to.equal(undefined);
    expect(parseStudioMessage({ type: 'export-png', data: 'x' })).to.equal(undefined);
    expect(parseStudioMessage({ type: 'run-command', command: 'labelStudio.deploy' })).to.equal(undefined);
  });
});
