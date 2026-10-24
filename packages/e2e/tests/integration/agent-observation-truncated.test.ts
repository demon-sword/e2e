/**
 * `observationTruncated` on agent steps: the act loop and a judgment both
 * report whether the screen the step ended on was cut by the observation
 * byte budget, so a blocked step reads as a truncated tree, not a missing control.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defineEngine, type EngineSnapshot } from '../../src/engine/index.ts';
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

const ENGINE_SUITE = `import { test } from 'e2e';

test('acts on the screen', async ({ agent }) => {
  await agent.act('look at the page');
});

test('judges the screen', async ({ agent }) => {
  await agent.assert('the page is visible', { vision: true });
});
`;

const VIEWPORT = { width: 2, height: 2 };

function engineWith(snapshot: EngineSnapshot) {
  return defineEngine({
    name: 'truncation-fixture',
    version: '1',
    spiVersion: 1,
    platform: 'fixture',
    observe: async () => snapshot,
  });
}

describe('observationTruncated from the engine capture', () => {
  const cases = [
    [
      'an engine that stopped listing nodes at its own limit',
      {
        root: { ref: { id: 'root', revision: '' }, children: [{ ref: { id: 'save', revision: '' }, role: 'button', name: 'Save' }] },
        viewport: VIEWPORT,
        truncated: true,
      } satisfies EngineSnapshot,
    ],
    [
      'a pixels-only capture with no tree',
      {
        root: { ref: { id: 'root', revision: '' } },
        viewport: VIEWPORT,
        treeUnavailable: true,
        pixels: { data: new Uint8Array([1, 2, 3]), mediaType: 'image/png', ...VIEWPORT, scale: 1 },
        maskedRegionCount: 0,
      } satisfies EngineSnapshot,
    ],
  ] as const;

  it.each(cases)('reports true on act and on a judgment for %s', async (_label, snapshot) => {
    const model = installFakeLoopModel(() => [
      { toolName: 'complete_step', input: { status: 'passed', summary: 'looked' } },
    ]);
    const judge = installFakeModel(() => judgment(true, 'it is'), { modelId: 'judge' });
    const { project, outcome } = await runProject(
      { 'tests/engine-truncated.e2e.ts': ENGINE_SUITE },
      {
        appUrl: 'https://fixture.test',
        config: {
          tests: 'tests/**/*.e2e.ts',
          targets: [{ name: 'fixture', engine: engineWith(snapshot) }],
          agents: { default: { model, judge } },
        },
      },
    );
    try {
      for (const [title, api] of [['acts on the screen', 'agent.act'], ['judges the screen', 'agent.assert']]) {
        const step = resultByTitle(outcome, title!).attempts.at(-1)!.steps.find((candidate) => candidate.api === api)!;
        expect(step.observationTruncated, `${api} on ${_label}`).toBe(true);
      }
    } finally {
      project.cleanup();
    }
  }, 60_000);
});
