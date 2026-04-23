import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main() {
  try {
    const extensionDevelopmentPath = path.resolve(__dirname, '..', '..');
    const extensionTestsPath = path.resolve(__dirname, 'suite', 'index');
    const fixtureWorkspace = path.resolve(
      extensionDevelopmentPath,
      'src',
      'test',
      'fixtures',
    );
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [fixtureWorkspace],
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Failed to run extension tests');
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  }
}

void main();
