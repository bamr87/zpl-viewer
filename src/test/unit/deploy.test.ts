import { expect } from 'chai';
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import {
  DEFAULT_RAW_PORT,
  describePrinter,
  normalizePrinter,
  normalizePrinters,
  validatePrinter,
} from '../../deploy/printers';
import {
  encodeLabelStream,
  sendToPrinter,
  spoolFileName,
} from '../../deploy/transports';
import { buildDeployPayload, deployLabel } from '../../deploy/deploy';

const ZPL = '^XA^PW812^LL406^FO20,20^A0N,40,40^FDHello^FS^XZ';

describe('deploy.printers', () => {
  it('fills in defaults for a sparse profile', () => {
    const profile = normalizePrinter({ name: 'Dock 1', host: '10.0.0.5' });
    expect(profile?.transport).to.equal('tcp');
    expect(profile?.port).to.equal(DEFAULT_RAW_PORT);
    expect(profile?.format).to.equal('zpl');
    expect(profile?.dpmm).to.equal(8);
  });

  it('rejects entries without a name and drops duplicates', () => {
    expect(normalizePrinter({ host: 'x' })).to.equal(undefined);
    expect(normalizePrinter('nope')).to.equal(undefined);
    const printers = normalizePrinters([
      { name: 'A', host: 'h' },
      { name: 'A', host: 'other' },
      { name: '' },
    ]);
    expect(printers.map((printer) => printer.name)).to.deep.equal(['A']);
    expect(printers[0].host).to.equal('h');
  });

  it('normalizes density and transport', () => {
    const profile = normalizePrinter({
      name: 'Line 2',
      transport: 'directory',
      path: './spool',
      dpmm: 300,
      format: 'epl',
    });
    expect(profile?.transport).to.equal('directory');
    expect(profile?.format).to.equal('epl');
    // 300 is not a dpmm value; fall back to the common 8 dpmm.
    expect(profile?.dpmm).to.equal(8);
  });

  it('reports what makes a profile unusable', () => {
    expect(validatePrinter(normalizePrinter({ name: 'A' })!)).to.have.length(1);
    expect(
      validatePrinter(normalizePrinter({ name: 'A', transport: 'file' })!)[0],
    ).to.contain('No path set');
    expect(
      validatePrinter(normalizePrinter({ name: 'A', host: 'h', port: 99999 })!)[0],
    ).to.contain('out of range');
    expect(
      validatePrinter(normalizePrinter({ name: 'A', host: 'h' })!),
    ).to.have.length(0);
  });

  it('describes a printer in one line', () => {
    const profile = normalizePrinter({ name: 'A', host: '10.0.0.5', port: 9100 })!;
    expect(describePrinter(profile)).to.equal('tcp → 10.0.0.5:9100 · ZPL · 8 dpmm');
  });
});

describe('deploy.transports', () => {
  it('encodes the label stream one byte per character', () => {
    const encoded = encodeLabelStream('^GFA,1,1,1,ÿ');
    expect(encoded[encoded.length - 1]).to.equal(0xff);
  });

  it('names spool files by timestamp and language', () => {
    const profile = normalizePrinter({
      name: 'S',
      transport: 'directory',
      path: '.',
      format: 'epl',
    })!;
    const name = spoolFileName(profile, new Date('2026-01-02T03:04:05.000Z'));
    expect(name).to.equal('label-2026-01-02T03-04-05-000Z.epl');
  });

  it('writes to a file target', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'label-deploy-'));
    const target = path.join(dir, 'printer.raw');
    const profile = normalizePrinter({
      name: 'File',
      transport: 'file',
      path: target,
    })!;
    const result = await sendToPrinter(profile, ZPL);
    expect(result.bytesSent).to.equal(ZPL.length);
    expect(fs.readFileSync(target, 'latin1')).to.equal(ZPL);
  });

  it('appends when the profile asks for it', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'label-deploy-'));
    const target = path.join(dir, 'printer.raw');
    const profile = normalizePrinter({
      name: 'File',
      transport: 'file',
      path: target,
      append: true,
    })!;
    await sendToPrinter(profile, 'A');
    await sendToPrinter(profile, 'B');
    expect(fs.readFileSync(target, 'latin1')).to.equal('AB');
  });

  it('drops a timestamped file into a spool directory', async () => {
    const dir = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'label-deploy-')),
      'spool',
    );
    const profile = normalizePrinter({
      name: 'Spool',
      transport: 'directory',
      path: dir,
    })!;
    const result = await sendToPrinter(profile, ZPL);
    expect(fs.existsSync(result.target)).to.equal(true);
    expect(fs.readdirSync(dir)).to.have.length(1);
  });

  it('sends over a raw TCP socket and reads the printer response', async () => {
    const received: Buffer[] = [];
    const server = net.createServer((socket) => {
      socket.on('data', (chunk) => received.push(chunk));
      socket.write('READY');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as net.AddressInfo).port;

    try {
      const profile = normalizePrinter({
        name: 'Net',
        host: '127.0.0.1',
        port,
      })!;
      const result = await sendToPrinter(profile, ZPL, { responseWaitMs: 50 });
      expect(result.bytesSent).to.equal(ZPL.length);
      expect(result.target).to.equal(`127.0.0.1:${port}`);
      expect(result.response).to.equal('READY');
      expect(Buffer.concat(received).toString('latin1')).to.equal(ZPL);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('fails with a useful message when nothing is listening', async () => {
    const profile = normalizePrinter({
      name: 'Dead',
      host: '127.0.0.1',
      port: 1,
    })!;
    let message = '';
    try {
      await sendToPrinter(profile, ZPL, { timeoutMs: 1000 });
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).to.contain('127.0.0.1:1');
  });
});

describe('deploy.deploy', () => {
  it('passes a matching language through untouched', () => {
    const profile = normalizePrinter({ name: 'A', host: 'h', format: 'zpl' })!;
    const built = buildDeployPayload({ profile, source: ZPL });
    expect(built.converted).to.equal(false);
    expect(built.payload).to.equal(ZPL);
  });

  it('converts the label when the printer speaks another language', () => {
    const profile = normalizePrinter({ name: 'B', host: 'h', format: 'epl' })!;
    const built = buildDeployPayload({ profile, source: ZPL });
    expect(built.converted).to.equal(true);
    expect(built.payload).to.contain('A20,20,');
    expect(built.warnings[0]).to.contain('Converted ZPL to EPL');
  });

  it('refuses to send when the profile is incomplete', async () => {
    const profile = normalizePrinter({ name: 'Broken' })!;
    const outcome = await deployLabel({ profile, source: ZPL });
    expect(outcome.ok).to.equal(false);
    expect(outcome.error).to.contain('No host set');
  });

  it('builds the payload without connecting on a dry run', async () => {
    const profile = normalizePrinter({ name: 'A', host: '127.0.0.1', port: 1 })!;
    const outcome = await deployLabel({ profile, source: ZPL, dryRun: true });
    expect(outcome.ok).to.equal(true);
    expect(outcome.payload).to.equal(ZPL);
    expect(outcome.warnings.join(' ')).to.contain('Dry run');
    expect(outcome.result).to.equal(undefined);
  });

  it('reports a failed send instead of throwing', async () => {
    const profile = normalizePrinter({ name: 'A', host: '127.0.0.1', port: 1 })!;
    const outcome = await deployLabel({
      profile,
      source: ZPL,
      send: { timeoutMs: 1000 },
    });
    expect(outcome.ok).to.equal(false);
    expect(outcome.error).to.be.a('string');
  });

  it('sends a converted label end to end', async () => {
    const received: Buffer[] = [];
    const server = net.createServer((socket) => {
      socket.on('data', (chunk) => received.push(chunk));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as net.AddressInfo).port;

    try {
      const profile = normalizePrinter({
        name: 'EPL printer',
        host: '127.0.0.1',
        port,
        format: 'epl',
      })!;
      const outcome = await deployLabel({
        profile,
        source: ZPL,
        send: { responseWaitMs: 50 },
      });
      expect(outcome.ok).to.equal(true);
      expect(outcome.converted).to.equal(true);
      const sent = Buffer.concat(received).toString('latin1');
      expect(sent).to.contain('N\nq812');
      expect(sent).to.contain('P1');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
