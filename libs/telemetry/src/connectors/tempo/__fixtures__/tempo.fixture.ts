export const TRACE_ID_HEX = '0af7651916cd43dd8448eb211c80319c';
export const ROOT_SPAN_ID_HEX = 'b7ad6b7169203331';
export const CHILD_SPAN_ID_HEX = '00f067aa0ba902b7';

const base64 = (hex: string): string => Buffer.from(hex, 'hex').toString('base64');

/**
 * Shaped like Tempo's v2 trace-by-ID body. The root span carries base64 IDs and
 * string enums; the child hex IDs and numeric enums, as different encoders emit.
 */
export const TEMPO_TRACE_RESPONSE = {
  trace: {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: 'checkout' } },
            { key: 'k8s.pod.restarts', value: { intValue: '3' } },
          ],
        },
        scopeSpans: [
          {
            scope: { name: 'otel-js' },
            spans: [
              {
                traceId: base64(TRACE_ID_HEX),
                spanId: base64(ROOT_SPAN_ID_HEX),
                parentSpanId: '',
                name: 'POST /checkout',
                kind: 'SPAN_KIND_SERVER',
                startTimeUnixNano: '1758783600000000000',
                endTimeUnixNano: '1758783600250500000',
                attributes: [
                  { key: 'http.response.status_code', value: { intValue: '502' } },
                  { key: 'retry', value: { boolValue: true } },
                  { key: 'ratio', value: { doubleValue: 0.5 } },
                  { key: 'tags', value: { arrayValue: { values: [{ stringValue: 'a' }, { stringValue: 'b' }] } } },
                  { key: 'db', value: { kvlistValue: { values: [{ key: 'system', value: { stringValue: 'postgresql' } }] } } },
                ],
                status: { code: 'STATUS_CODE_ERROR', message: 'upstream failed' },
                events: [
                  {
                    name: 'exception',
                    timeUnixNano: '1758783600200000000',
                    attributes: [{ key: 'exception.message', value: { stringValue: 'gateway timeout' } }],
                  },
                ],
              },
              {
                traceId: TRACE_ID_HEX.toUpperCase(),
                spanId: CHILD_SPAN_ID_HEX,
                parentSpanId: base64(ROOT_SPAN_ID_HEX),
                name: 'charge',
                kind: 3,
                startTimeUnixNano: 1758783600010000000,
                endTimeUnixNano: '1758783600210000000',
                status: {},
              },
            ],
          },
        ],
      },
    ],
  },
};

/** Shaped like Tempo's `/api/search` body. */
export const TEMPO_SEARCH_RESPONSE = {
  traces: [
    {
      traceID: '2F3E0CEE77AE5DC9C17ADE3689EB2E54',
      rootServiceName: 'checkout',
      rootTraceName: 'POST /checkout',
      startTimeUnixNano: '1758783600000000000',
      durationMs: 250,
      spanSets: [
        {
          spans: [
            {
              spanID: '563D623C76514F8E',
              startTimeUnixNano: '1758783600010000000',
              durationNanos: '200000000',
              attributes: [{ key: 'status', value: { stringValue: 'error' } }],
            },
          ],
          matched: 4,
        },
      ],
    },
    {
      traceID: '6f1b49',
      startTimeUnixNano: '1758783500000000000',
      spanSet: { spans: [], matched: 0 },
    },
  ],
  metrics: { inspectedTraces: 120 },
};
