/** The agent's tools (ADR 0018, Tools); all read-only. */
export enum InvestigationTool {
  RunChecks = 'run_checks',
  CheckIndicator = 'check_indicator',
  DescribeVertex = 'describe_vertex',
  Subgraph = 'subgraph',
  Impact = 'impact',
  SearchLogs = 'search_logs',
  SearchTraces = 'search_traces',
  GetTrace = 'get_trace',
  Conclude = 'conclude',
}
