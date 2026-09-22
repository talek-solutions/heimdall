/**
 * Anthropic Messages API response body (the `Message` object).
 */

import {
    AnthropicMessageRole,
    AnthropicMessageType,
    AnthropicRefusalCategory,
    AnthropicStopReason,
} from './messages.enums';
import { AnthropicContentBlock, AnthropicUsage } from './messages.shared';

/** Populated only when `stopReason` is `REFUSAL`; `null` for every other stop reason. */
export interface AnthropicStopDetails {
    type: AnthropicStopReason.REFUSAL;
    category?: AnthropicRefusalCategory | null;
    explanation?: string;
}

export interface AnthropicMessagesResponse {
    id: string;
    type: AnthropicMessageType;
    role: AnthropicMessageRole.ASSISTANT;
    content: AnthropicContentBlock[];
    /** Server data; deliberately not constrained to `AnthropicModel`. */
    model: string;
    stopReason: AnthropicStopReason | null;
    stopSequence: string | null;
    stopDetails: AnthropicStopDetails | null;
    usage: AnthropicUsage;
}
