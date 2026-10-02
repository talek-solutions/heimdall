import type { ILLMToolDefinition } from '@heimdall/llm';
import { IndicatorRole } from '@heimdall/core/manifest';

export const SELECT_ENTRY_TOOL = 'select_entry';

/** Frozen, so the prefix stays cacheable across investigations (ADR 0004). */
export const TRIAGE_SYSTEM_PROMPT = `You locate the part of a software system that an incident report is about.

You receive the system's index: one line per functionality, flow, component and member, each starting with its id, followed by what it is and what it depends on. You also receive an engineer's report, in their own words.

Answer only by calling ${SELECT_ENTRY_TOOL} once.

candidates: ids from the index that the report is most likely about, best first, each with a confidence between 0 and 1 and a one-sentence reason. Prefer a functionality or flow when the report describes what users experience, and a component or member when it names infrastructure. Give a lower confidence when the report could mean several parts. Return no candidates when nothing in the index fits.

symptomRoles: the kinds of signal that would show the reported problem. errors: requests fail. throughput: traffic drops or stops. latency: things are slow or time out. saturation: a resource such as a pool, CPU or memory is exhausted. lag: queues, consumers or replicas fall behind. kpi: a business outcome moves.`;

export function selectEntryTool(vertexIds: readonly string[]): ILLMToolDefinition {
  return {
    name: SELECT_ENTRY_TOOL,
    description:
      'Report which parts of the system the incident report is about, and how the problem would show.',
    strict: true,
    inputSchema: {
      type: 'object',
      properties: {
        candidates: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              vertexId: { type: 'string', enum: [...vertexIds] },
              confidence: { type: 'number', description: 'Between 0 and 1.' },
              reason: { type: 'string' },
            },
            required: ['vertexId', 'confidence', 'reason'],
            additionalProperties: false,
          },
        },
        symptomRoles: {
          type: 'array',
          items: { type: 'string', enum: Object.values(IndicatorRole) },
        },
      },
      required: ['candidates', 'symptomRoles'],
      additionalProperties: false,
    },
  };
}

export function triageMessage(
  index: string,
  query: string,
  exactMatches: readonly string[],
): string {
  const hints =
    exactMatches.length === 0
      ? ''
      : `\nNames in the report that match the index exactly: ${exactMatches.join(', ')}`;

  return `Index:\n${index}\nReport: ${query}${hints}`;
}
