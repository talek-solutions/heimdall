import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { ScenarioLoader } from './scenario.loader';
import { defaultScenariosRoot } from './scenarios-root';

const CHECKPOINTS = 240;

/** Guards the committed scenarios against rot: each must load and stay finite end to end. */
describe('shipped scenarios', async () => {
  const root = defaultScenariosRoot();
  const names = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  it('ships the documented scenarios', () => {
    for (const name of ['healthy-baseline', 'increased-latency-1']) {
      assert.ok(names.includes(name), name);
    }
  });

  for (const name of names) {
    it(`${name} loads and yields finite values across its timeline`, async () => {
      const scenario = await new ScenarioLoader().load(root, name);

      assert.ok(scenario.metrics.length > 0);
      for (const series of scenario.metrics) {
        for (let index = 0; index <= CHECKPOINTS; index += 1) {
          const value = series.curve.valueAt((scenario.durationMs * index) / CHECKPOINTS);
          assert.ok(Number.isFinite(value), `${series.id} at checkpoint ${index}`);
        }
      }
    });
  }
});
