/** Response bodies shaped like Loki 3.x `/loki/api/v1/query(_range)`. */
export const LOKI_STREAMS_RESPONSE = {
  status: 'success',
  data: {
    resultType: 'streams',
    result: [
      {
        stream: { service_name: 'checkout', level: 'error' },
        values: [
          ['1758783600000000001', 'payment gateway timeout after 30000ms'],
          ['1758783599000000000', 'retrying charge', { trace_id: '0af7651916cd43dd8448eb211c80319c' }],
        ],
      },
    ],
    stats: { summary: { bytesProcessedPerSecond: 1024 } },
  },
};

export const LOKI_MATRIX_RESPONSE = {
  status: 'success',
  data: {
    resultType: 'matrix',
    result: [
      {
        metric: { service_name: 'checkout' },
        values: [
          [1758783600, '12'],
          [1758783660.5, 'NaN'],
        ],
      },
    ],
  },
};

export const LOKI_VECTOR_RESPONSE = {
  status: 'success',
  data: {
    resultType: 'vector',
    result: [{ metric: { level: 'error' }, value: [1758783600, '3'] }],
  },
};
