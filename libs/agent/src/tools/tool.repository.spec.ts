import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { concludeTool, echoTool, throwingTool } from '../__fixtures__/agent.fixture';
import { AgentError, AgentErrorCode } from '../errors';
import { ToolRepository } from './tool.repository';

describe('ToolRepository', () => {
  it('looks tools up by name', () => {
    const echo = echoTool();
    const repository = ToolRepository.of([echo, concludeTool()]);

    assert.equal(repository.get('echo'), echo);
    assert.equal(repository.get('missing'), undefined);
  });

  it('renders provider-neutral specs sorted by name, whatever the order tools were given in', () => {
    const repository = ToolRepository.of([echoTool(), throwingTool(), concludeTool()]);

    assert.deepEqual(
      repository.specs().map((spec) => spec.name),
      ['conclude', 'echo', 'explode'],
    );
    assert.deepEqual(repository.specs()[1], {
      name: 'echo',
      description: 'Echoes its text',
      inputSchema: echoTool().inputSchema,
    });
  });

  it('rejects two tools with the same name', () => {
    assert.throws(
      () => ToolRepository.of([echoTool(), echoTool()]),
      (error: unknown) =>
        error instanceof AgentError &&
        error.errorCode === AgentErrorCode.DuplicateTool &&
        error.message.includes("'echo'"),
    );
  });
});
