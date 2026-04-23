import { assertFixtureMatchesGolden } from './visualHarness';

describe('visual regression: hello', () => {
  it('matches golden output', () => {
    assertFixtureMatchesGolden('hello.zpl', 'hello.png');
  });
});
