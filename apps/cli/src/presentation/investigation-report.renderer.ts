import { MitigationTier, type IInvestigationReport } from '@heimdall/investigation';

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
  return result === undefined
    ? id
    : `${id} (${result.subject} ${result.role} ${result.verdict ?? result.signal})`;
}
