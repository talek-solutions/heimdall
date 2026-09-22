export const AnthropicApiKeyHeader = 'x-api-key';

export const AnthropicVersionHeader = 'anthropic-version';

/** Comma-separated list of beta feature flags (e.g. task budgets). */
export const AnthropicBetaHeader = 'anthropic-beta';

export const AnthropicWorkspaceIdHeader = 'anthropic-workspace-id';

export const AnthropicUserProfileIdHeader = 'anthropic-user-profile-id';

export const DEFAULT_ANTHROPIC_API_URL = 'https://api.anthropic.com';

export const DEFAULT_ANTHROPIC_API_VERSION = '2023-06-01';

/** Anthropic requires `max_tokens`; sized for non-streaming calls. */
export const DEFAULT_ANTHROPIC_MAX_TOKENS = 16000;
