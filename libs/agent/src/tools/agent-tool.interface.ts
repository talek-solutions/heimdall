import type { ToolAccess, ToolResultStatus } from '../enums';

export interface IToolContext {
  /** The provider's id for this call. */
  readonly callId: string;
  /** Aborts when the run's time budget runs out. */
  readonly signal: AbortSignal;
}

export interface IToolResult {
  readonly status: ToolResultStatus;
  /** JSON-serialisable; the only part the model reads. */
  readonly content: unknown;
  /** One line for events. Never recorded in traces (ADR 0017, content policy). */
  readonly summary: string;
  /** Budget units this call used, e.g. backend queries; 0 when omitted. */
  readonly cost?: number;
}

export type IToolInputParse<TInput> =
  { readonly ok: true; readonly input: TInput } | { readonly ok: false; readonly problem: string };

/**
 * A tool, written once for every provider (ADR 0017). The schema guides the model and the
 * provider; `parse` is what protects `execute`, and it must enforce every constraint the
 * schema states, since a provider's port may strip some of them.
 */
export interface IAgentTool<TInput = unknown> {
  readonly name: string;
  readonly description: string;
  /** JSON Schema of type 'object'. */
  readonly inputSchema: Record<string, unknown>;
  readonly access: ToolAccess;
  parse(input: unknown): IToolInputParse<TInput>;
  execute(input: TInput, context: IToolContext): Promise<IToolResult>;
}
