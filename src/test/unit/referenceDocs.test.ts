// docs/reference/*.md is generated from package.json `contributes`; this fails
// the unit suite when a command, setting or keybinding changes without the
// reference being regenerated (`npm run docs:reference`).
import { expect } from 'chai';
import { spawnSync } from 'child_process';
import * as path from 'path';

describe('generated reference docs', () => {
  it('docs/reference matches package.json contributes', () => {
    const root = path.resolve(__dirname, '..', '..', '..');
    const run = spawnSync(process.execPath, [path.join(root, 'scripts', 'gen-reference-docs.mjs'), '--check'], {
      cwd: root,
      encoding: 'utf8',
    });
    expect(run.status, run.stderr).to.equal(0);
  });
});
