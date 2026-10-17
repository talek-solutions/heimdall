import {
  MitigationTier,
  ResultKind,
  type ICheckResult,
  type IInvestigationReport,
  type IReportRedaction,
} from '@heimdall/investigation';

const TIER_ORDER: readonly MitigationTier[] = [
  MitigationTier.Immediate,
  MitigationTier.ShortTerm,
  MitigationTier.Prevention,
];

/** The conclusion for a terminal: what is wrong, where it starts, what shows it, what to do. */
export function renderReport(report: IInvestigationReport): string {
  const { conclusion, usage } = report;
  const lines = [
    '',
    `conclusion     ${report.outcome}${conclusion === undefined ? '' : ` (confidence ${conclusion.confidence.toFixed(2)})`}`,
  ];

  if (conclusion === undefined) {
    lines.push(
      `               the agent ended without a conclusion (${report.agentReason ?? 'unknown'})`,
    );
  } else {
    lines.push(`summary        ${conclusion.summary}`);
    if (conclusion.cause !== undefined) {
      lines.push(`cause          ${conclusion.cause.vertex} — ${conclusion.cause.mechanism}`);
    }
    if (conclusion.origin !== undefined) {
      lines.push(
        `origin         ${conclusion.origin.step}${conclusion.origin.uncertain ? ' (uncertain)' : ''}`,
      );
    }
    lines.push(
      `evidence       ${conclusion.evidence.length === 0 ? '(none)' : conclusion.evidence.map((id) => describeResult(report, id)).join(', ')}`,
    );
    const mitigations = [...conclusion.mitigations].sort(
      (left, right) => TIER_ORDER.indexOf(left.tier) - TIER_ORDER.indexOf(right.tier),
    );
    if (mitigations.length > 0) {
      lines.push('', 'mitigations');
      for (const { tier, action, tradeoff } of mitigations) {
        lines.push(`  ${tier.padEnd(11)} ${action}`, `  ${''.padEnd(11)} trade-off: ${tradeoff}`);
      }
    }
  }
  for (const { vertex, reason } of report.reachedPruned) {
    lines.push(`looked beyond  ${vertex}: ${reason}`);
  }
  lines.push(...renderRedaction(report.redaction));
  lines.push(
    '',
    `usage          ${usage.turns} turns · ${usage.toolCalls} tool calls · ${usage.toolCost} queries · ${usage.inputTokens} in / ${usage.outputTokens} out tokens · ${(usage.elapsedMs / 1_000).toFixed(1)}s`,
  );
  if (report.traceId !== undefined) {
    lines.push(`trace          ${report.traceId}`);
  }
  return `${lines.join('\n')}\n`;
}

function describeResult(report: IInvestigationReport, id: string): string {
  const result = report.results.find((candidate) => candidate.result === id);
  return result === undefined ? id : `${id} (${result.subject} ${reading(result)})`;
}

function reading(result: ICheckResult): string {
  switch (result.kind) {
    case ResultKind.Indicator:
      return `${result.role} ${result.verdict ?? result.signal}`;
    case ResultKind.Logs:
      return `logs: ${result.templates.new.length} new, ${result.templates.surging.length} surging`;
    case ResultKind.Traces:
      return `traces: ${result.operations.filter((operation) => operation.changes.length > 0).length} changed`;
    case ResultKind.Trace:
      return `${result.trace?.spans.length ?? 0} spans`;
  }
}

/**
 * What never left, for whoever tunes the manifest: counts, and the names of dropped fields, which
 * this local report is the only place to show (ADR 0008).
 */
function renderRedaction({ totals, droppedFields }: IReportRedaction): string[] {
  if (totals.records === 0) {
    return [];
  }
  const matches = Object.entries(totals.matches);
  const lines = [
    `redaction      ${totals.records} records · ${totals.fieldsDropped} fields dropped · ${matches.length === 0 ? 'no secrets matched' : matches.map(([scrubber, count]) => `${count} ${scrubber}`).join(', ')}${totals.truncated === 0 ? '' : ` · ${totals.truncated} values cut`}`,
  ];

  for (const { subject, fields } of droppedFields) {
    lines.push(`  dropped      ${subject}: ${fields.join(', ')}`);
  }
  return lines;
}
