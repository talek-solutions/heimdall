import { LlmError, LlmErrorCode } from '../../errors';
import type { ILLMToolDefinition } from '../interfaces/chat.request';
import type { ILLMToolCapabilities, ILLMToolPort, ILLMToolSpec } from '../interfaces/tool-port.interface';
import type { AnthropicProviderOptions } from './anthropic.options';
import { AnthropicCacheControlType } from './api/messages.enums';

type JsonSchema = Record<string, unknown>;

const TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/;

/** Strict tool use rejects numeric, string-length and complex array constraints. */
const UNSUPPORTED_KEYWORDS: ReadonlySet<string> = new Set([
    'minimum',
    'maximum',
    'exclusiveMinimum',
    'exclusiveMaximum',
    'multipleOf',
    'minLength',
    'maxLength',
    'maxItems',
    'uniqueItems',
    'contains',
]);

const SCHEMA_MAPS = ['properties', '$defs', 'definitions'];
const SCHEMA_LISTS = ['anyOf', 'allOf', 'oneOf', 'prefixItems'];

/**
 * Anthropic's rules for tools: a name pattern, strict schemas (every object closed and listing
 * `required`, unsupported keywords stripped), and a cache breakpoint on the system prompt, which
 * also caches the tools rendered before it.
 */
export class AnthropicToolPort implements ILLMToolPort<AnthropicProviderOptions> {
    readonly capabilities: ILLMToolCapabilities = {
        strictSchemas: true,
        parallelToolCalls: true,
        // Current models answer a forced `tool_choice` with a 400.
        forcedToolChoice: false,
        namePattern: TOOL_NAME,
    };

    render(specs: readonly ILLMToolSpec[]): ILLMToolDefinition[] {
        return specs.map((spec) => {
            if (!TOOL_NAME.test(spec.name)) {
                throw new LlmError(LlmErrorCode.UNSUPPORTED_REQUEST, `tool name '${spec.name}' must match ${TOOL_NAME.source}`);
            }
            if (spec.inputSchema['type'] !== 'object') {
                throw new LlmError(LlmErrorCode.UNSUPPORTED_REQUEST, `tool '${spec.name}' inputSchema must be a JSON Schema of type 'object'`);
            }
            return { name: spec.name, description: spec.description, inputSchema: toStrictSchema(spec.inputSchema), strict: true };
        });
    }

    requestOptions(): AnthropicProviderOptions {
        return { systemCacheControl: { type: AnthropicCacheControlType.EPHEMERAL } };
    }
}

function toStrictSchema(schema: JsonSchema): JsonSchema {
    const strict: JsonSchema = {};

    for (const [keyword, value] of Object.entries(schema)) {
        if (UNSUPPORTED_KEYWORDS.has(keyword) || (keyword === 'minItems' && typeof value === 'number' && value > 1)) {
            continue;
        }
        strict[keyword] = toStrictValue(keyword, value);
    }
    if (strict['type'] === 'object' || strict['properties'] !== undefined) {
        strict['additionalProperties'] = false;
        strict['required'] = Array.isArray(strict['required']) ? strict['required'] : [];
    }
    return strict;
}

function toStrictValue(keyword: string, value: unknown): unknown {
    if (SCHEMA_MAPS.includes(keyword) && isSchema(value)) {
        return Object.fromEntries(Object.entries(value).map(([name, inner]) => [name, isSchema(inner) ? toStrictSchema(inner) : inner]));
    }
    if (SCHEMA_LISTS.includes(keyword) && Array.isArray(value)) {
        return value.map((inner: unknown) => (isSchema(inner) ? toStrictSchema(inner) : inner));
    }
    if (keyword === 'items' && isSchema(value)) {
        return toStrictSchema(value);
    }
    return value;
}

function isSchema(value: unknown): value is JsonSchema {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
