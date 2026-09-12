export enum OutputFormat {
  /** Human-readable streaming text. Progress to stderr, result to stdout. */
  Text = 'text',
  /** A single JSON object on stdout when the investigation completes. */
  Json = 'json',
  /** One JSON event per line on stdout as the investigation progresses. */
  Ndjson = 'ndjson',
}
