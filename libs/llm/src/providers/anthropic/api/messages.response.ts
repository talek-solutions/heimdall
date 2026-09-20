/**
 * Anthropic Messages API response body (the `Message` object).
 */

import { AnthropicModel } from '../anthropic.enums';
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
    model: AnthropicModel;
    stopReason: AnthropicStopReason | null;
    stopSequence: string | null;
    stopDetails: AnthropicStopDetails | null;
    usage: AnthropicUsage;
}
