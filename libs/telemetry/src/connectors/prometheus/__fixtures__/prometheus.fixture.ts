/** Response bodies shaped like Prometheus 3.x `/api/v1/query(_range)`. */
export const PROMETHEUS_VECTOR_RESPONSE = {
  status: 'success',
  data: {
    resultType: 'vector',
    result: [{ metric: { __name__: 'up', job: 'checkout' }, value: [1758783600.123, '0'] }],
  },
};

export const PROMETHEUS_MATRIX_RESPONSE = {
  status: 'success',
  data: {
    resultType: 'matrix',
    result: [
      {
        metric: { job: 'checkout' },
        values: [
          [1758783600, '0.25'],
          [1758783660, '+Inf'],
        ],
      },
    ],
  },
  warnings: ['PromQL info: metric might not be a counter'],
};

export const PROMETHEUS_SCALAR_RESPONSE = {
  status: 'success',
  data: { resultType: 'scalar', result: [1758783600, '42'] },
};

export const PROMETHEUS_STRING_RESPONSE = {
  status: 'success',
  data: { resultType: 'string', result: [1758783600, 'hello'] },
};

export const PROMETHEUS_ERROR_RESPONSE = {
  status: 'error',
  errorType: 'execution',
  error: 'query processing would load too many samples into memory',
};
