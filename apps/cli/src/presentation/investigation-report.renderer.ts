import {
  BlindSpotReason,
  BlindSpotTouch,
  ConclusionOutcome,
  DeviationDirection,
  ImpactStatus,
  MitigationTier,
  ObjectiveVerdict,
  OperationChange,
  ProfileShape,
  ProfileState,
  QueryUnit,
  ResultKind,
  ResultVerdict,
  type ICheckResult,
  type IInvestigationReport,
  type ILogsResult,
  type IProfile,
  type IReportRedaction,
  type IRoleResult,
  type ITracesResult,
} from '@heimdall/investigation';

const TIER_ORDER: readonly MitigationTier[] = [
  MitigationTier.Immediate,
  MitigationTier.ShortTerm,
  MitigationTier.Prevention,
];
const LABEL = 15;
const SPARKS = '▁▂▃▄▅▆▇█';
const MAX_EXAMPLES = 2;
const MAX_TEXT = 48;
/** Under this, times carry seconds. */
const SHORT_WINDOW_MS = 15 * 60_000;
/** From this effect on, a rise reads as a multiple: 13× rather than +1253%. */
const MULTIPLE_FROM_PERCENT = 100;

const STORY: Readonly<
  Record<Exclude<ProfileShape, ProfileShape.Flat>, Readonly<Record<DeviationDirection, string>>>
> = {
  [ProfileShape.Step]: {
    [DeviationDirection.Up]: 'step up at',
    [DeviationDirection.Down]: 'step down at',
  },
  [ProfileShape.Ramp]: {
    [DeviationDirection.Up]: 'climbing since',
    [DeviationDirection.Down]: 'falling since',
  },
  [ProfileShape.Spike]: {
    [DeviationDirection.Up]: 'spike at',
    [DeviationDirection.Down]: 'dip at',
  },
};
const NOW: Readonly<Record<ProfileState, string>> = {
  [ProfileState.Ongoing]: 'still',
  [ProfileState.Recovering]: 'easing, now',
  [ProfileState.Recovered]: 'back to',
};
const BLIND: Readonly<Record<BlindSpotReason, string>> = {
  [BlindSpotReason.NoTelemetry]: 'emits no telemetry',
  [BlindSpotReason.NoIndicators]: 'has no indicators',
};
const LEANS_ON: Readonly<Record<BlindSpotReason, string>> = {
  [BlindSpotReason.NoTelemetry]: 'only what its neighbours saw supports it',
  [BlindSpotReason.NoIndicators]: 'only its logs and traces show it',
};
const VERDICT: Readonly<Record<ResultVerdict, string>> = {
  [ResultVerdict.Unhealthy]: 'unhealthy',
  [ResultVerdict.Healthy]: 'healthy',
  [ResultVerdict.NoData]: 'no data',
};

/**
 * The conclusion for a terminal, in reading order: what is wrong and what to do, how far to trust
 * it, then the proof. Times are UTC and numbers have no locale, so the output is the same on every
 * machine: the golden files pin it.
 */
export function renderReport(report: IInvestigationReport): string {
  const { usage } = report;
  const clock = clockFor(report);
  const footer = [
    ...report.reachedPruned.map(({ vertex, reason }) => `looked beyond  ${vertex}: ${reason}`),
    ...renderRedaction(report.redaction),
  ];
  const lines = [
    '',
    ...headline(report),
    ...mitigations(report),
    ...keyFigures(report, clock),
    ...blindSpots(report),
    ...impact(report),
    ...evidence(report),
    ...(footer.length === 0 ? [] : ['', ...footer]),
    '',
    `usage          ${usage.turns} turns · ${usage.toolCalls} tool calls · ${usage.toolCost} queries · ${usage.inputTokens} in / ${usage.outputTokens} out tokens · ${(usage.elapsedMs / 1_000).toFixed(1)}s`,
  ];

  if (report.traceId !== undefined) {
    lines.push(`trace          ${report.traceId}`);
  }
  return `${lines.join('\n')}\n`;
}

function headline({ outcome, conclusion, agentReason }: IInvestigationReport): string[] {
  if (conclusion === undefined) {
    return [
      `conclusion     ${outcome}`,
      `               the agent ended without a conclusion (${agentReason ?? 'unknown'})`,
    ];
  }
  const { cause, origin } = conclusion;

  return [
    `conclusion     ${outcome} (confidence ${conclusion.confidence.toFixed(2)})`,
    `summary        ${conclusion.summary}`,
    ...(cause === undefined ? [] : [`cause          ${cause.vertex} — ${cause.mechanism}`]),
    ...(origin === undefined
      ? []
      : [`origin         ${origin.step}${origin.uncertain ? ' (uncertain)' : ''}`]),
  ];
}

function mitigations({ conclusion }: IInvestigationReport): string[] {
  const sorted = [...(conclusion?.mitigations ?? [])].sort(
    (left, right) => TIER_ORDER.indexOf(left.tier) - TIER_ORDER.indexOf(right.tier),
  );

  return sorted.length === 0
    ? []
    : [
        '',
        'mitigations',
        ...sorted.flatMap(({ tier, action, tradeoff }) => [
          `  ${tier.padEnd(11)} ${action}`,
          `  ${''.padEnd(11)} trade-off: ${tradeoff}`,
        ]),
      ];
}

/** One figure per result: baseline to peak, a breach, and the shape of the window. */
function keyFigures(report: IInvestigationReport, clock: (iso: string) => string): string[] {
  const figures = report.keyFigures
    .map((id) => report.results.find(({ result }) => result === id))
    .filter((result) => result !== undefined);

  if (figures.length === 0) {
    return [];
  }
  const width = Math.max(...figures.map((result) => figureLabel(result).length));
  const changes = figures.filter(isIndicator).map(change);
  const changeWidth = Math.max(0, ...changes.map((text) => text.length));
  const indent = (label: string): string => `  ${label.padEnd(width)}  `;

  return [
    '',
    'key figures    times in UTC',
    ...figures.flatMap((result) => {
      const rows = figureRows(result, report.profiles[result.result], clock, changeWidth);
      return rows.map((row, index) =>
        `${indent(index === 0 ? figureLabel(result) : '')}${row}`.trimEnd(),
      );
    }),
  ];
}

function figureLabel(result: ICheckResult): string {
  return `${result.subject} ${result.kind === ResultKind.Indicator ? result.role : result.kind}`;
}

function figureRows(
  result: ICheckResult,
  profile: IProfile | undefined,
  clock: (iso: string) => string,
  changeWidth: number,
): string[] {
  switch (result.kind) {
    case ResultKind.Indicator:
      return [
        `${change(result).padEnd(changeWidth)}   ${breach(result, clock)}`,
        ...(profile === undefined ? [] : [`${spark(profile)}  ${story(result, profile, clock)}`]),
      ];
    case ResultKind.Logs:
      return logRows(result, clock);
    case ResultKind.Traces:
      return traceRows(result);
    case ResultKind.Trace:
      return [`${result.trace?.spans.length ?? 0} spans`];
  }
}

function change({ baseline, peak, unit }: IRoleResult): string {
  if (baseline === null || peak === null) {
    return 'no data';
  }
  const effect = peak.effectPercent;
  const size =
    effect === null
      ? ''
      : effect >= MULTIPLE_FROM_PERCENT
        ? ` (${number(1 + effect / 100)}×)`
        : ` (${effect > 0 ? '+' : ''}${Math.round(effect)}%)`;

  return `${quantity(baseline.median, unit)} → ${quantity(peak.value, unit)}${size}`;
}

function breach(result: IRoleResult, clock: (iso: string) => string): string {
  if (result.verdict !== ObjectiveVerdict.Breached || result.bounds === null) {
    return '';
  }
  const bounds = result.bounds.replace(
    /([≤≥≠] )(-?\d+(?:\.\d+)?(?:e[-+]?\d+)?)/g,
    (_, operator: string, value: string) => `${operator}${quantity(Number(value), result.unit)}`,
  );

  return `breached ${bounds}${result.breachOnset === null ? '' : ` at ${clock(result.breachOnset)}`}`;
}

function spark({ points }: IProfile): string {
  const present = points.filter((point) => point !== null);
  const low = Math.min(...present);
  const range = Math.max(...present) - low;

  return points
    .map((point) =>
      point === null
        ? ' '
        : (SPARKS[range === 0 ? 0 : Math.round(((point - low) / range) * (SPARKS.length - 1))] ??
          ' '),
    )
    .join('');
}

function story(result: IRoleResult, profile: IProfile, clock: (iso: string) => string): string {
  const last = profile.last === null ? 'no data' : quantity(profile.last, result.unit);
  const at = result.onset ?? result.peak?.at;

  if (profile.shape === ProfileShape.Flat || result.direction === null || at === undefined) {
    return `level with the baseline, now ${last}`;
  }
  const now = profile.state === null ? `now ${last}` : `${NOW[profile.state]} ${last}`;
  return `${STORY[profile.shape][result.direction]} ${clock(at)}, ${now}`;
}

/** New lines first, then surging ones; counts are of the sample, a lower bound when it was cut. */
function logRows(result: ILogsResult, clock: (iso: string) => string): string[] {
  const templates = [...result.templates.new, ...result.templates.surging].slice(0, MAX_EXAMPLES);
  const sampled = result.sampled.capped ? ' (sampled)' : '';

  return templates.length === 0
    ? ['no new or surging lines']
    : templates.map(
        ({ template, count, firstSeen }) =>
          `"${clip(template)}" ${count.baseline} → ${count.window} lines${sampled}, first at ${clock(firstSeen)}`,
      );
}

function traceRows(result: ITracesResult): string[] {
  const changed = result.operations
    .filter(({ changes }) => changes.length > 0)
    .slice(0, MAX_EXAMPLES);

  return changed.length === 0
    ? ['no operation changed']
    : changed.map(({ name, changes, durationMs, errorTraces }) => {
        const p50 = `p50 ${milliseconds(durationMs.p50.baseline)} → ${milliseconds(durationMs.p50.window)}`;
        const errors = changes.includes(OperationChange.Errors)
          ? `, failing in ${errorTraces.baseline} → ${errorTraces.window} error traces`
          : '';
        return `"${clip(name)}" ${changes.join(', ')}: ${p50}${errors}`;
      });
}

/**
 * The blind spots the conclusion leans on. A no-signal run lists all of them instead: a clean
 * result says nothing about what could not be seen.
 */
function blindSpots({ blindSpots: spots, plan, outcome }: IInvestigationReport): string[] {
  const others = plan.blindSpots.length - spots.length;
  const rows =
    outcome === ConclusionOutcome.NoSignal && plan.blindSpots.length > 0
      ? [
          'no-signal does not cover these:',
          ...plan.blindSpots.map(({ vertex, reason }) => `${vertex} ${BLIND[reason]}`),
        ]
      : [
          ...spots.map(
            ({ vertex, reason, touches }) =>
              `${vertex} (${touchLabel(touches)}) ${BLIND[reason]}: ${LEANS_ON[reason]}`,
          ),
          ...(others === 0
            ? []
            : [`${others} ${spots.length === 0 ? '' : 'more '}in scope, outside the conclusion`]),
        ];

  if (rows.length === 0) {
    return [];
  }
  return [
    '',
    ...rows.map((row, index) => `${index === 0 ? 'blind spots' : ''}`.padEnd(LABEL) + row),
  ];
}

function touchLabel(touches: BlindSpotTouch): string {
  switch (touches) {
    case BlindSpotTouch.Cause:
      return 'the cause';
    case BlindSpotTouch.Origin:
      return 'the origin';
    case BlindSpotTouch.Evidence:
      return 'cited';
  }
}

/** What else is hurt; a flow that was not checked says so rather than passing for healthy. */
function impact({ impact: { status, subjects } }: IInvestigationReport): string[] {
  const rows =
    status === ImpactStatus.NotPlanned
      ? ['not checked: no impact flows in scope']
      : subjects.map(({ vertex, verdict, results }) =>
          verdict === null
            ? `${vertex} not checked`
            : `${vertex} ${VERDICT[verdict]} (${results.join(', ')})`,
        );

  return rows.map((row, index) => `${index === 0 ? 'impact' : ''}`.padEnd(LABEL) + row);
}

/** The cited results, grouped by what they look at. */
function evidence(report: IInvestigationReport): string[] {
  const cited = report.conclusion?.evidence ?? [];

  if (cited.length === 0) {
    return [];
  }
  // Per subject, results that read the same share one entry: r20 r21 saturation anomalous.
  const groups = new Map<string, Map<string, string[]>>();

  for (const id of cited) {
    const result = report.results.find((candidate) => candidate.result === id);
    const subject = result?.subject ?? '';
    const readings = groups.get(subject) ?? new Map<string, string[]>();
    const text = result === undefined ? '' : reading(result);

    readings.set(text, [...(readings.get(text) ?? []), id]);
    groups.set(subject, readings);
  }
  const width = Math.max(...[...groups.keys()].map((subject) => subject.length));

  return [
    '',
    ...[...groups].map(([subject, readings], index) => {
      const entries = [...readings].map(([text, ids]) => `${ids.join(' ')} ${text}`.trimEnd());
      return (
        `${index === 0 ? 'evidence' : ''}`.padEnd(LABEL) +
        `${subject.padEnd(width)}  ${entries.join(' · ')}`
      );
    }),
  ];
}

function reading(result: ICheckResult): string {
  switch (result.kind) {
    case ResultKind.Indicator:
      return `${result.role} ${result.verdict ?? result.signal}`;
    case ResultKind.Logs: {
      const counts = [
        [result.templates.new.length, 'new'],
        [result.templates.surging.length, 'surging'],
      ] as const;
      const changed = counts
        .filter(([count]) => count > 0)
        .map(([count, what]) => `${count} ${what}`);
      return `logs ${changed.length === 0 ? 'unchanged' : changed.join(', ')}`;
    }
    case ResultKind.Traces:
      return `traces ${result.operations.filter(({ changes }) => changes.length > 0).length} changed`;
    case ResultKind.Trace:
      return `trace ${result.trace?.spans.length ?? 0} spans`;
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

/** HH:MM in UTC, with seconds when the window is short enough for them to matter. */
function clockFor({ plan }: IInvestigationReport): (iso: string) => string {
  // A live report carries Dates, a parsed one ISO strings.
  const span = new Date(plan.window.end).getTime() - new Date(plan.window.start).getTime();
  const end = span < SHORT_WINDOW_MS ? 19 : 16;

  return (iso) => iso.slice(11, end);
}

function quantity(value: number, unit: string): string {
  switch (unit) {
    case QueryUnit.Seconds:
      return Math.abs(value) < 1 ? `${number(value * 1_000)}ms` : `${number(value)}s`;
    case QueryUnit.PerSecond:
      return `${number(value)}/s`;
    case QueryUnit.Ratio:
      return `${number(value * 100)}%`;
    default:
      return unit === '' ? number(value) : `${number(value)} ${unit}`;
  }
}

function milliseconds(value: number | null): string {
  return value === null ? '–' : `${number(value)}ms`;
}

/** Three significant digits, whole numbers from 1000 on, and never a locale's separators. */
function number(value: number): string {
  return Math.abs(value) >= 1_000
    ? Math.round(value).toString()
    : Number(value.toPrecision(3)).toString();
}

function clip(text: string): string {
  return text.length <= MAX_TEXT ? text : `${text.slice(0, MAX_TEXT - 1)}…`;
}

function isIndicator(result: ICheckResult): result is IRoleResult {
  return result.kind === ResultKind.Indicator;
}
