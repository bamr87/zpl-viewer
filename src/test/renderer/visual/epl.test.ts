import { assertFixtureMatchesGolden } from './visualHarness';

/**
 * The EPL fixture deliberately contains no text: bar and box rendering is
 * pixel-identical on every platform, so this golden does not need the
 * per-OS variants the text-bearing ZPL fixtures do.
 */
describe('visual regression: EPL geometry', () => {
  it('matches golden output', () => {
    assertFixtureMatchesGolden('epl-geometry.epl', 'epl-geometry.png');
  });
});
