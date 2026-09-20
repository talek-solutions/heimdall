/**
 * Provider-neutral chat response.
 *
 * Providers normalize their native reply into this shape. Anything with no
 * normalized counterpart (e.g. Anthropic `stopDetails`) stays reachable via
 * `raw`, which each provider types with its own response shape.
 */

import { LLMFinishReason, LLMMessageRole } from './chat.enums';
import { ILLMOutputContentPart, ILLMUsage } from './chat.shared';

export interface ILLMProviderMessageResponse<TRaw = unknown> {
    /** Provider-issued response id. */
    id: string;
    /** Model that actually served the request, as reported by the provider. */
    model: string;
    role: LLMMessageRole.ASSISTANT;
    content: ILLMOutputContentPart[];
    finishReason: LLMFinishReason;
    usage: ILLMUsage;
    /** The unmodified provider response, for debugging and provider-specific fields. */
    raw?: TRaw;
}
