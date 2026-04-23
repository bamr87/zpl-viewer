import { assertFixtureMatchesGolden } from './visualHarness';

describe('visual regression: product', () => {
  it('matches golden output', () => {
    assertFixtureMatchesGolden('product.zpl', 'product.png');
  });
});
