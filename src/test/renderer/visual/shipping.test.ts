import { assertFixtureMatchesGolden } from './visualHarness';

describe('visual regression: shipping', () => {
  it('matches golden output', () => {
    assertFixtureMatchesGolden('shipping.zpl', 'shipping.png');
  });
});
