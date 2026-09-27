const NAME = '[a-z0-9]([-a-z0-9]*[a-z0-9])?';
const METRIC = '[A-Za-z_:][A-Za-z0-9_:]*';

/** Joins a component and one of its dependencies or metrics: `services-2/orders-db`. */
export const REFERENCE_SEPARATOR = '/';

export const RESOURCE_NAME = new RegExp(`^${NAME}$`);
export const RESOURCE_NAME_MESSAGE =
  '$property must be lowercase letters, digits and dashes, starting and ending alphanumeric';

export const METRIC_NAME = new RegExp(`^${METRIC}$`);
export const METRIC_NAME_MESSAGE =
  '$property must be a Prometheus metric name such as http_server_requests_seconds';

export const METRIC_REFERENCE = new RegExp(`^(${NAME}${REFERENCE_SEPARATOR})?${METRIC}$`);
export const METRIC_REFERENCE_MESSAGE =
  '$property must be a metric name, or component/metric such as services-2/orders_created_total';

export const DEPENDENCY_REFERENCE = new RegExp(`^${NAME}${REFERENCE_SEPARATOR}${NAME}$`);
export const DEPENDENCY_REFERENCE_MESSAGE =
  '$property must be component/dependency such as services-2/orders-db';

/** Prometheus and Loki label names. */
export const LABEL_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Log fields and config keys, which may be dotted: `trace_id`, `http.status`. */
export const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

/** A camelCase meaning such as `traceId` or `orderId`. */
export const SEMANTIC_NAME = /^[a-z][A-Za-z0-9]*$/;
export const SEMANTIC_NAME_MESSAGE = '$property must be a camelCase name such as orderId';

/** Kubernetes label key syntax: `env`, `example.com/team`. */
export const METADATA_LABEL_KEY =
  /^([a-z0-9]([-a-z0-9.]*[a-z0-9])?\/)?[A-Za-z0-9]([-A-Za-z0-9_.]*[A-Za-z0-9])?$/;
