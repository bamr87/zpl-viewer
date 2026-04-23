import { expect } from 'chai';
import {
  __test,
  findCommand,
  renderCommandMarkdown,
  ZPL_COMMANDS,
} from '../../zplCommands';

describe('zplCommands', () => {
  it('finds known commands and ^A variants', () => {
    expect(findCommand('^FO')?.title).to.equal('Field Origin');
    expect(findCommand('^A0')?.name).to.equal('A');
    expect(findCommand('^AN')?.name).to.equal('A');
    expect(findCommand('^ZZ')).to.equal(undefined);
  });

  it('renders markdown with sections', () => {
    const cmd = findCommand('^BC');
    expect(cmd).to.not.equal(undefined);
    if (!cmd) {
      return;
    }
    const md = renderCommandMarkdown(cmd);
    expect(md).to.contain('**`^BC`');
    expect(md).to.contain('**Parameters**');
  });

  it('exposes command index for tests', () => {
    expect(ZPL_COMMANDS.length).to.be.greaterThan(10);
    expect(__test.commandIndex.has('^XA')).to.equal(true);
  });
});
