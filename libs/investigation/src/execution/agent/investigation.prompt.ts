import {
  describeIndicator,
  describeSelector,
  renderLevelZero,
  type SystemGraph,
} from '@heimdall/core/graph';
import { CheckKind } from '../../enums';
import type { ICheck, IInvestigationPlan } from '../../interfaces';
import { ConclusionOutcome, MitigationTier, ResultVerdict } from '../conclusion/conclusion.enums';
import { ObjectiveVerdict, PreliminarySignal } from '../health/health.enums';
import { InvestigationTool } from '../tools/investigation-tool.enum';

/** Byte-stable across runs and turns, so it stays a cached prefix (ADR 0004). */
export const INVESTIGATION_SYSTEM_PROMPT = `You are Heimdall's investigation agent. An engineer reported a problem. Heimdall has located where in the system it most likely lives and planned checks against the system's telemetry. Find out what is broken, where the fault starts and why, using the tools, then call ${InvestigationTool.Conclude}. Heimdall is read-only: you observe, you never change the system.

Method
1. Confirm: is it broken, and since when? The onset can narrow the window for the rest.
2. Localise: run the step checks of each suspect flow. The fault starts at the deepest unhealthy step of a sync flow, and at the first unhealthy stage of an async flow.
3. Explain and corroborate: run the checks whose condition names the origin step; checks gated on other steps are rarely needed.
4. Impact: what else is hurt. It is reported, never a cause.
Use ${InvestigationTool.RunChecks} for planned checks, ${InvestigationTool.CheckIndicator} for any other indicator in reach, ${InvestigationTool.SearchLogs}, ${InvestigationTool.SearchTraces} and ${InvestigationTool.GetTrace} for logs and spans beyond the plan, and ${InvestigationTool.DescribeVertex}, ${InvestigationTool.Subgraph} and ${InvestigationTool.Impact} to read the system's structure.

Reading results
- Every result has an id (r1, r2, ...). Cite these ids when you conclude.
- verdict is code's verdict for slo, threshold and nonZero expectations (${Object.values(ObjectiveVerdict).join(', ')}). It stands; you cannot override it.
- For baseline expectations, signal is a preliminary reading from robust statistics (${Object.values(PreliminarySignal).join(', ')}): the peak's z-score and effect against the baseline median, the longest run of deviating points, and the onset. You decide the verdict.
- no-data is never healthy. When a step without data sits deeper than the deepest unhealthy step of a sync flow, the origin is uncertain.
- A result with zoom deviated briefly or borderline at its step. Re-run the check over that window before deciding.
- direction says which way a throughput or KPI moved.
- Logs and traces results are evidence: cite them, never give them a verdict. They come from samples of the window and of the baseline before it, so counts are of the samples, not totals.
- A logs result groups lines by template (variable parts as <*>). new templates are absent from the baseline (confirmedAbsent says a baseline query agreed), surging ones grew at least threefold; both carry the first and last example. A component whose stream is new only logs in the window, e.g. a job that started then. correlation lists key values to search the other side of a hop with.
- A traces result lists the subject's operations that are new, slower (p50 or share of the trace) or failing more than in the baseline, with an exemplar trace. ${InvestigationTool.GetTrace} reads a trace id found in a log example.
- Only fields the manifest maps reach you, and secrets are replaced by [REDACTED:<kind>]. redaction counts what was dropped or replaced; if evidence you need was dropped, say so rather than guess.

Budget
Every turn and every backend query counts. Batch checks into one ${InvestigationTool.RunChecks} call where you can.

Concluding
- ${ConclusionOutcome.CauseFound}: the cause vertex and its mechanism, the origin step, the results that show it, and mitigations in three tiers (${Object.values(MitigationTier).join(', ')}), each with its trade-off.
- ${ConclusionOutcome.NoSignal}: nothing in scope is unhealthy.
- ${ConclusionOutcome.Inconclusive}: something is wrong, but the evidence does not settle what. Say what is missing.
Give a verdict (${Object.values(ResultVerdict).join(', ')}) for every result you rely on. When the cause is a blind spot, say that the conclusion rests on its callers' view of it.`;

/** The run's opening message: the plan and the system, compact and deterministic. */
export function seedMessage(plan: IInvestigationPlan, graph: SystemGraph): string {
  const { scope } = plan;

  return [
    `Report: "${plan.query}" in ${plan.system}${plan.environment === undefined ? '' : ` · ${plan.environment.name}`}`,
    `Window: ${plan.window.start.toISOString()} → ${plan.window.end.toISOString()}, against ${plan.window.baseline.start.toISOString()} → ${plan.window.baseline.end.toISOString()}`,
    `Symptom roles: ${plan.symptom.roles.join(', ')} (${plan.symptom.method})`,
    `Entry: ${plan.entry.vertex} (${plan.entry.method})`,
    '',
    'System',
    renderLevelZero(graph, plan.environment?.name),
    '',
    'Scope',
    `suspect flows: ${scope.suspectFlows.join(', ') || '(none)'}`,
    `impact flows: ${scope.impactFlows.join(', ') || '(none)'}`,
    `in scope: ${scope.vertices.map(({ vertex, reason }) => `${vertex} (${reason})`).join(', ')}`,
    `pruned: ${scope.pruned.map(({ vertex, reason }) => `${vertex} (${reason})`).join(', ') || '(none)'}`,
    `blind spots: ${plan.blindSpots.map(({ vertex, reason }) => `${vertex} (${reason})`).join(', ') || '(none)'}`,
    '',
    `Plan (${plan.checks.length} checks${plan.omittedChecks > 0 ? `, ${plan.omittedChecks} omitted by the cap` : ''})`,
    ...plan.checks.map(describeCheck),
  ].join('\n');
}

function describeCheck(check: ICheck): string {
  const what =
    check.kind === CheckKind.Indicator && check.indicator !== undefined
      ? `${check.subject} · ${describeIndicator(check.indicator)}${check.roles.length > 0 ? ` · roles ${check.roles.join('/')}` : ''}`
      : `${check.subject} · ${check.kind}${check.match === undefined ? '' : ` {${describeSelector(check.match)}}`}${check.hop === undefined ? '' : ` · ${check.hop.side} of ${check.hop.dependency}`}`;
  const when =
    check.when === undefined ? '' : ` · if it starts at ${check.when.failingSteps.join(' or ')}`;

  return `${check.id} ${check.tier} ${what}${when} — ${check.rationale}`;
}
