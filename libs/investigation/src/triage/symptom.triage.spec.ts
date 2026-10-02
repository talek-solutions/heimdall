import 'reflect-metadata';
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import type { SystemGraph } from '@heimdall/core/graph';
import { IndicatorRole } from '@heimdall/core/manifest';
import { LLMMessageRole, LLMToolChoiceType } from '@heimdall/llm';
import {
  FakeLlmProvider,
  loadGraph,
  ReferenceManifest,
  selectEntryCall,
  testConfig,
  textOnly,
} from '../__fixtures__/investigation.fixture';
import { InvestigationError, InvestigationErrorCode } from '../errors';
import { SymptomTriage } from './symptom.triage';
import { SELECT_ENTRY_TOOL, TRIAGE_SYSTEM_PROMPT } from './triage.prompt';

const ORDERING = {
  vertexId: 'functionality:ordering',
  confidence: 0.9,
  reason: 'checkout is ordering',
};
const SUBMIT = { vertexId: 'flow:submit-order', confidence: 0.6, reason: 'the submit step' };

describe('SymptomTriage', () => {
  let graph: SystemGraph;

  before(async () => {
    graph = await loadGraph(ReferenceManifest.Shop);
  });

  it('sends only the index and the query, answering through one strict tool', async () => {
    const llm = new FakeLlmProvider([
      selectEntryCall({ candidates: [ORDERING], symptomRoles: ['errors'] }),
    ]);

    await new SymptomTriage(llm, testConfig()).classify('checkouts are not working', graph, 'prod');
    const [request] = llm.requests;
    const tool = request?.tools?.[0];
    const message = request?.messages[0];

    assert.equal(request?.model, 'test-model');
    assert.equal(request?.system, TRIAGE_SYSTEM_PROMPT);
    assert.deepEqual(request?.toolChoice, { type: LLMToolChoiceType.AUTO });
    assert.equal(tool?.name, SELECT_ENTRY_TOOL);
    assert.equal(tool?.strict, true);
    assert.equal(message?.role, LLMMessageRole.USER);
    assert.ok(typeof message?.content === 'string');
    assert.ok(message.content.startsWith('Index:\nsystem shop · env prod'));
    assert.ok(message.content.includes('Report: checkouts are not working'));
    assert.ok(!message.content.includes('mysql-1:9104'));
  });

  it('constrains the answer to locatable ids and known roles', async () => {
    const llm = new FakeLlmProvider([
      selectEntryCall({ candidates: [ORDERING], symptomRoles: [] }),
    ]);

    await new SymptomTriage(llm, testConfig()).classify('x', graph);
    const schema = JSON.stringify(llm.requests[0]?.tools?.[0]?.inputSchema);

    assert.ok(schema.includes('"functionality:ordering"'));
    assert.ok(schema.includes('"member:mysql-main/replica-1"'));
    assert.ok(!schema.includes('"step:submit-order#1"'));
    assert.ok(!schema.includes('"indicator:'));
  });

  it('returns candidates best first and roles once each', async () => {
    const llm = new FakeLlmProvider([
      selectEntryCall({
        candidates: [SUBMIT, ORDERING],
        symptomRoles: ['errors', 'errors', 'kpi'],
      }),
    ]);

    const result = await new SymptomTriage(llm, testConfig()).classify('x', graph);

    assert.deepEqual(
      result.candidates.map((candidate) => candidate.vertex),
      ['functionality:ordering', 'flow:submit-order'],
    );
    assert.deepEqual(result.roles, [IndicatorRole.Errors, IndicatorRole.Kpi]);
  });

  it('passes vertex names written in the report as hints', async () => {
    const llm = new FakeLlmProvider([selectEntryCall({ candidates: [], symptomRoles: [] })]);

    await new SymptomTriage(llm, testConfig()).classify('mysql-main is slow', graph);

    assert.ok(
      String(llm.requests[0]?.messages[0]?.content).endsWith(
        'Names in the report that match the index exactly: component:mysql-main',
      ),
    );
  });

  it('retries once when the model answers without the tool', async () => {
    const llm = new FakeLlmProvider([
      textOnly('I think it is ordering'),
      selectEntryCall({ candidates: [ORDERING], symptomRoles: ['errors'] }),
    ]);

    const result = await new SymptomTriage(llm, testConfig()).classify('x', graph);

    assert.equal(llm.requests.length, 2);
    assert.equal(result.candidates[0]?.vertex, 'functionality:ordering');
  });

  it('fails after a second invalid answer', async () => {
    const unknown = { vertexId: 'component:nope', confidence: 0.9, reason: 'made up' };
    const llm = new FakeLlmProvider([
      selectEntryCall({ candidates: [unknown], symptomRoles: [] }),
      selectEntryCall({ candidates: [{ ...ORDERING, confidence: 2 }], symptomRoles: [] }),
    ]);

    await assert.rejects(
      new SymptomTriage(llm, testConfig()).classify('x', graph),
      (error) =>
        error instanceof InvestigationError &&
        error.errorCode === InvestigationErrorCode.TriageFailed,
    );
  });
});
