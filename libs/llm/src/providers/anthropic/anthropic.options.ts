import type { AnthropicEffort } from './api/messages.enums';
import type { AnthropicTaskBudget, AnthropicThinkingConfig } from './api/messages.request';
import type { AnthropicCacheControl } from './api/messages.shared';

/**
 * Anthropic-only knobs for `providerOptions`. Anything with a provider-neutral
 * counterpart belongs on the abstract request instead.
 */
export interface AnthropicProviderOptions {
    /** Overrides the adaptive default derived from `reasoning`. */
    readonly thinking?: AnthropicThinkingConfig;
    /** Full scale incl. `xhigh`/`max`; overrides `reasoning.effort`. */
    readonly effort?: AnthropicEffort;
    /** Requires the task-budgets beta flag in `betas`. */
    readonly taskBudget?: AnthropicTaskBudget;
    /** Cache breakpoint on the system prompt — the dominant cost lever (ADR 0004). */
    readonly systemCacheControl?: AnthropicCacheControl;
    readonly topK?: number;
    /** Sent as the `anthropic-beta` header. */
    readonly betas?: readonly string[];
}
