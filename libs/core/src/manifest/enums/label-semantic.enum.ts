/**
 * What a metric label *means*. Flow steps select metrics by these semantics rather
 * than by raw label names, which differ per exporter (`consumergroup`, `group`, …).
 */
export enum LabelSemantic {
  Route = 'route',
  Method = 'method',
  StatusCode = 'statusCode',
  Outcome = 'outcome',
  Operation = 'operation',
  Table = 'table',
  Topic = 'topic',
  ConsumerGroup = 'consumerGroup',
  Instance = 'instance',
}
