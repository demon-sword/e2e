/**
 * `observationTruncated` on agent steps: the act loop and a judgment both
 * report whether the screen the step ended on was cut by the observation
 * byte budget, so a blocked step reads as a truncated tree, not a missing control.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startFixtureApp, type FixtureApp } from '../helpers/fixture-app.ts';
import { installFakeLoopModel } from '../helpers/fake-loop-model.ts';
import { installFakeModel, judgment } from '../helpers/fake-model.ts';
import { resultByTitle, runProject } from '../helpers/run-project.ts';
import type { RunOutcome } from '../helpers/run-project.ts';

const SUITE = `import { test } from 'e2e';

test('acts on the screen', async ({ app, agent }) => {
  await app.open();
  await agent.act('look at the page');
});

test('judges the screen', async ({ app, agent }) => {
  await app.open();
  await agent.assert('the page is visible');
});
`;

describe('observationTruncated', () => {
  let app: FixtureApp;
  const outcomes = new Map<string, RunOutcome>();

  beforeAll(async () => {
    app = await startFixtureApp();
    for (const [label, agentOptions] of [['cut', { maxObservationBytes: 1_024 }], ['whole', {}]] as const) {
      const model = installFakeLoopModel(() => [
        { toolName: 'complete_step', input: { status: 'passed', summary: 'looked' } },
      ]);
      const judge = installFakeModel(() => judgment(true, 'it is'), { modelId: 'judge' });
      const run = await runProject(
        { 'tests/truncated.e2e.ts': SUITE },
        {
          appUrl: app.url,
          config: { tests: 'tests/**/*.e2e.ts', agents: { default: { model, judge, ...agentOptions } } },
        },
      );
      outcomes.set(label, run.outcome);
      run.project.cleanup();
    }
  }, 180_000);

  afterAll(async () => {
    await app?.close();
  });

  const flagOf = (label: string, title: string, api: string) =>
    resultByTitle(outcomes.get(label)!, title).attempts.at(-1)!.steps.find((step) => step.api === api)!
      .observationTruncated;

  it.each([
    ['acts on the screen', 'agent.act'],
    ['judges the screen', 'agent.assert'],
  ])('reports a screen cut by the byte budget for %s', (title, api) => {
    expect(flagOf('cut', title, api)).toBe(true);
  });

  it.each([
    ['acts on the screen', 'agent.act'],
    ['judges the screen', 'agent.assert'],
  ])('reports a whole screen as not truncated for %s', (title, api) => {
    expect(flagOf('whole', title, api)).toBe(false);
  });
});
