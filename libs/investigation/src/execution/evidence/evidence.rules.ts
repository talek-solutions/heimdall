// `.docs/design/log-and-trace-evidence.md`: every number below is a rule of that note.

// Log sampling and templates.
export const LOG_SLICES = 4;
export const MIN_NEW_COUNT = 2;
export const SURGE_RATIO = 3;
export const MIN_SURGE_COUNT = 5;
export const VANISHED_MIN_SHARE = 0.02;
export const MAX_FLAGGED_TEMPLATES = 8;
export const MAX_STEADY_TEMPLATES = 5;
export const MAX_VANISHED_TEMPLATES = 3;
export const EXAMPLES_PER_TEMPLATE = 2;
export const MAX_CONFIRMATIONS = 3;
export const MIN_LITERAL_LENGTH = 8;
export const MAX_MESSAGE_LENGTH = 300;
export const MAX_TEMPLATE_LENGTH = 160;
export const MAX_CORRELATION_VALUES = 5;

// Trace sampling and operations.
export const TRACE_SLICES = 2;
export const SPANS_PER_SPAN_SET = 25;
export const SLOWER_RATIO = 1.5;
export const MIN_SLOWER_DELTA_MS = 5;
export const SHARE_RATIO = 1.5;
export const MAX_OPERATIONS = 10;
export const MAX_ERROR_TYPES = 3;
export const MAX_EXEMPLAR_SPANS = 40;
