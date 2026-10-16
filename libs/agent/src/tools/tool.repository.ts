import type { ILLMToolSpec } from '@heimdall/llm';
import { AgentError, AgentErrorCode } from '../errors';
import type { IAgentTool } from './agent-tool.interface';

/** The tools of one agent. Knows no domain: callers bring the tools (ADR 0017). */
export class ToolRepository {
  private constructor(private readonly byName: ReadonlyMap<string, IAgentTool>) {}

  static of(tools: readonly IAgentTool[]): ToolRepository {
    const byName = new Map<string, IAgentTool>();

    for (const tool of tools) {
      if (byName.has(tool.name)) {
        throw new AgentError(AgentErrorCode.DuplicateTool, `two tools are named '${tool.name}'`);
      }
      byName.set(tool.name, tool);
    }
    return new ToolRepository(byName);
  }

  get(name: string): IAgentTool | undefined {
    return this.byName.get(name);
  }

  get names(): string[] {
    return [...this.byName.keys()].sort();
  }

  /** Sorted by name: the tool list renders first in every request, so it must never change order. */
  specs(): ILLMToolSpec[] {
    return this.names.flatMap((name) => {
      const tool = this.byName.get(name);
      return tool === undefined
        ? []
        : [{ name: tool.name, description: tool.description, inputSchema: tool.inputSchema }];
    });
  }
}
