/** Series ids are referenced from `ref:` fields and `{ref:…}` placeholders. */
export const SERIES_ID_PATTERN = /^[a-z][a-z0-9_]*$/;
export const SERIES_ID_MESSAGE = '$property must be a lowercase identifier such as checkout_p99_latency';

/** Prometheus and Loki label names. */
export const LABEL_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const DURATION_MESSAGE = '$property must be a duration such as 30s, 5m, 1h30m or 2d';
