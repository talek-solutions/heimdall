/** What a result holds: an indicator's statistics, or logs, spans or a trace as evidence. */
export enum ResultKind {
  Indicator = 'indicator',
  Logs = 'logs',
  Traces = 'traces',
  Trace = 'trace',
}
