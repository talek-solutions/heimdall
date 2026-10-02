import { describeExpectation, describeSelector } from '@heimdall/core/graph';
import {
  CheckKind,
  CheckTier,
  type ICheck,
  type IInvestigationEvent,
  type IInvestigationPlan,
  InvestigationEventType,
} from '@heimdall/investigation';

const TIERS: readonly { readonly tier: CheckTier; readonly heading: string }[] = [
  { tier: CheckTier.Confirm, heading: 'confirm: is it broken, and since when?' },
  {
    tier: CheckTier.Localise,
    heading: 'localise: where does it start? (sync: deepest failing hop, async: first)',
  },
  {
    tier: CheckTier.Explain,
    heading: 'explain: why that step? (only behind the step it starts at)',
  },
  { tier: CheckTier.Corroborate, heading: 'corroborate: logs and traces for the explanation' },
  { tier: CheckTier.Impact, heading: 'impact: what else is hurt' },
];
const NONE = '(none)';

/** One stderr line per stage while the plan is built; `undefined` for stages with nothing to say. */
export function describeProgress(event: IInvestigationEvent): string | undefined {
  switch (event.type) {
    case InvestigationEventType.Started:
      return `investigating "${event.query}" in ${event.system}${event.environment === undefined ? '' : ` · ${event.environment.name}`}`;
    case InvestigationEventType.SymptomClassified:
      return `symptom: ${event.symptom.roles.join(', ')} (${event.symptom.method})`;
    case InvestigationEventType.EntryLocated:
      return `entry: ${event.entry.vertex} (${event.entry.method}${event.entry.confidence === undefined ? '' : `, ${event.entry.confidence.toFixed(2)}`})`;
    case InvestigationEventType.ScopeResolved:
      return `scope: ${event.scope.vertices.length} in scope, ${event.scope.pruned.length} ruled out`;
    case InvestigationEventType.PlanReady:
      return undefined;
  }
}

/** The plan as a tree for a terminal: what will be checked, why, and what was ruled out. */
export function renderPlan(plan: IInvestigationPlan): string {
  const { entry, environment, scope, symptom, window } = plan;
  const lines = [
    `investigation  ${plan.query}`,
    `system         ${plan.system}${environment === undefined ? '' : ` · ${environment.name} (context ${environment.context})`}`,
    `window         ${window.start.toISOString()} → ${window.end.toISOString()}, against the window before`,
    `symptom        ${symptom.roles.join(', ')} (${symptom.method})`,
    `entry          ${entry.vertex} (${entry.method}${entry.confidence === undefined ? '' : `, ${entry.confidence.toFixed(2)}`})${entry.reason === undefined ? '' : ` — ${entry.reason}`}`,
    `suspect flows  ${list(scope.suspectFlows)}`,
    `impact flows   ${list(scope.impactFlows)}`,
    '',
    'checks',
  ];

  for (const { tier, heading } of TIERS) {
    const checks = plan.checks.filter((check) => check.tier === tier);

    if (checks.length > 0) {
      lines.push(`  ${heading}`, ...checks.flatMap(renderCheck));
    }
  }
  if (plan.omittedChecks > 0) {
    lines.push(`  … ${plan.omittedChecks} more checks over the cap`);
  }
  lines.push(
    '',
    'blind spots',
    ...indentOrNone(plan.blindSpots.map(({ vertex, reason }) => `${vertex}  ${reason}`)),
    '',
    'ruled out',
    ...indentOrNone(scope.pruned.map(({ vertex, reason }) => `${vertex}  ${reason}`)),
  );
  return `${lines.join('\n')}\n`;
}

function renderCheck(check: ICheck): string[] {
  const condition =
    check.when === undefined ? '' : ` · if it starts at ${check.when.failingSteps.join(' or ')}`;
  return [
    `    ${check.id.padEnd(4)} ${check.subject} · ${describeCheck(check)}`,
    `         ${check.rationale}${condition}`,
  ];
}

function describeCheck(check: ICheck): string {
  const selector = describeSelector(check.match ?? check.indicator?.selector ?? {});
  const narrowed = selector === '' ? '' : ` {${selector}}`;

  if (check.kind !== CheckKind.Indicator || check.indicator === undefined) {
    const joined = check.correlationKey === undefined ? '' : ` joined on ${check.correlationKey}`;
    return `${check.kind}${narrowed}${joined}`;
  }
  const { metric, ratio, expect } = check.indicator;
  const measured =
    metric ?? (ratio === undefined ? '(query)' : `${ratio.numerator} / ${ratio.denominator}`);

  return `${check.roles.join('/')} ${measured}${narrowed} ${describeExpectation(expect)}`;
}

function list(items: readonly string[]): string {
  return items.length === 0 ? NONE : items.join(', ');
}

function indentOrNone(items: readonly string[]): string[] {
  return (items.length === 0 ? [NONE] : items).map((item) => `  ${item}`);
}
