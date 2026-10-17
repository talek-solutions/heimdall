import { FieldSemantic } from '@heimdall/config';
import type { ILogRecord } from '@heimdall/telemetry';
import type {
  ILogExample,
  ILogsResult,
  ILogTemplate,
  ILogTemplateCount,
} from './evidence-result.interface';
import {
  EXAMPLES_PER_TEMPLATE,
  MAX_CONFIRMATIONS,
  MAX_CORRELATION_VALUES,
  MAX_FLAGGED_TEMPLATES,
  MAX_MESSAGE_LENGTH,
  MAX_STEADY_TEMPLATES,
  MAX_VANISHED_TEMPLATES,
  MIN_NEW_COUNT,
  MIN_SURGE_COUNT,
  SURGE_RATIO,
  VANISHED_MIN_SHARE,
} from './evidence.rules';
import { logTemplate, templateId, templateLiteral, VARIABLE_TOKEN } from './log-template';

export interface ILogSamples {
  readonly window: readonly ILogRecord[];
  readonly baseline: readonly ILogRecord[];
}

/** One template across both samples. */
export interface ITemplateTally {
  readonly id: string;
  readonly template: string;
  /** What a baseline query can look for; absent when the template has too little literal text. */
  readonly literal: string | undefined;
  window: number;
  baseline: number;
  readonly occurrences: ILogRecord[];
  readonly severities: Map<string, number>;
  readonly correlation: Set<string>;
}

/** Whether a baseline query found a template the baseline sample did not have. */
export type Confirmations = ReadonlyMap<string, boolean>;

/** Groups both samples by template (`.docs/design/log-and-trace-evidence.md`, Templates). */
export function tallyTemplates(
  samples: ILogSamples,
  correlationKey: string | undefined,
): Map<string, ITemplateTally> {
  const tallies = new Map<string, ITemplateTally>();
  const tallyOf = (record: ILogRecord): ITemplateTally => {
    const template = templateOf(record);
    const id = templateId(template);
    const existing = tallies.get(id);

    if (existing !== undefined) {
      return existing;
    }
    const created: ITemplateTally = {
      id,
      template,
      literal: templateLiteral(template),
      window: 0,
      baseline: 0,
      occurrences: [],
      severities: new Map(),
      correlation: new Set(),
    };
    tallies.set(id, created);
    return created;
  };

  for (const record of samples.baseline) {
    tallyOf(record).baseline += 1;
  }
  for (const record of samples.window) {
    const tally = tallyOf(record);
    const severity = record.fields[FieldSemantic.Severity];
    const key = correlationKey === undefined ? undefined : record.fields[correlationKey];

    tally.window += 1;
    tally.occurrences.push(record);
    if (severity !== undefined) {
      tally.severities.set(severity, (tally.severities.get(severity) ?? 0) + 1);
    }
    if (key !== undefined && tally.correlation.size < MAX_CORRELATION_VALUES) {
      tally.correlation.add(key);
    }
  }
  return tallies;
}

/** New by the sample, most frequent first: the ones worth one baseline query each. */
export function confirmationCandidates(
  tallies: ReadonlyMap<string, ITemplateTally>,
  baselineSize: number,
): ITemplateTally[] {
  if (baselineSize === 0) {
    return [];
  }
  return [...tallies.values()]
    .filter((tally) => isNewBySample(tally) && tally.literal !== undefined)
    .sort((a, b) => b.window - a.window)
    .slice(0, MAX_CONFIRMATIONS);
}

/** New, surging, steady and vanished, by the rules of the design note, capped for the agent. */
export function classifyTemplates(
  tallies: ReadonlyMap<string, ITemplateTally>,
  sizes: { readonly window: number; readonly baseline: number },
  confirmations: Confirmations,
  options: {
    readonly correlationKey: string | undefined;
    /** A search for literal text: the agent asked for those lines, so steady ones show too. */
    readonly searched: boolean;
  },
): Pick<ILogsResult, 'templates' | 'correlation'> {
  const { correlationKey, searched } = options;
  const fresh: ILogTemplate[] = [];
  const surging: Array<{ readonly template: ILogTemplate; readonly ratio: number }> = [];
  const steady: Array<ILogTemplateCount | ILogTemplate> = [];
  const vanished: ILogTemplateCount[] = [];
  const flaggedTallies: ITemplateTally[] = [];
  const baselineFloor = sizes.baseline === 0 ? 1 : 1 / sizes.baseline;

  for (const tally of tallies.values()) {
    const confirmed = sizes.baseline === 0 ? true : confirmations.get(tally.id);

    if (isNewBySample(tally) && confirmed !== false) {
      fresh.push(detailed(tally, sizes.window, confirmed ?? null));
      flaggedTallies.push(tally);
      continue;
    }
    const shareWindow = sizes.window === 0 ? 0 : tally.window / sizes.window;
    const shareBaseline = sizes.baseline === 0 ? 0 : tally.baseline / sizes.baseline;
    const ratio = shareWindow / Math.max(shareBaseline, baselineFloor);

    if (tally.window >= MIN_SURGE_COUNT && ratio >= SURGE_RATIO) {
      surging.push({ template: detailed(tally, sizes.window, confirmed ?? null), ratio });
      flaggedTallies.push(tally);
    } else if (tally.window === 0 && shareBaseline >= VANISHED_MIN_SHARE) {
      vanished.push(counted(tally));
    } else if (tally.window > 0) {
      steady.push(searched ? detailed(tally, sizes.window, null) : counted(tally));
    }
  }
  const flagged = [
    ...fresh.sort((a, b) => b.count.window - a.count.window),
    ...surging.sort((a, b) => b.ratio - a.ratio).map(({ template }) => template),
  ].slice(0, MAX_FLAGGED_TEMPLATES);
  const kept = new Set(flagged.map((template) => template.id));
  const values = flaggedTallies
    .filter((tally) => kept.has(tally.id))
    .flatMap((tally) => [...tally.correlation]);

  return {
    templates: {
      new: flagged.filter((template) => fresh.includes(template)),
      surging: flagged.filter((template) => !fresh.includes(template)),
      steady: steady.sort((a, b) => b.count.window - a.count.window).slice(0, MAX_STEADY_TEMPLATES),
      vanished: vanished
        .sort((a, b) => b.count.baseline - a.count.baseline)
        .slice(0, MAX_VANISHED_TEMPLATES),
    },
    correlation:
      correlationKey === undefined
        ? null
        : { key: correlationKey, values: [...new Set(values)].slice(0, MAX_CORRELATION_VALUES) },
  };
}

function isNewBySample(tally: ITemplateTally): boolean {
  return tally.baseline === 0 && tally.window >= MIN_NEW_COUNT;
}

/** The message, or the mapped field names when a structured line maps no message. */
function templateOf(record: ILogRecord): string {
  const message = record.fields[FieldSemantic.Message];

  if (message !== undefined) {
    return logTemplate(message);
  }
  const names = Object.keys(record.fields).sort();
  return names.length === 0
    ? '(no mapped fields)'
    : names.map((name) => `${name}=${VARIABLE_TOKEN}`).join(' ');
}

function counted(tally: ITemplateTally): ILogTemplateCount {
  return {
    id: tally.id,
    template: tally.template,
    count: { window: tally.window, baseline: tally.baseline },
    severity: dominant(tally.severities),
  };
}

function detailed(
  tally: ITemplateTally,
  windowSize: number,
  confirmedAbsent: boolean | null,
): ILogTemplate {
  const first = tally.occurrences[0];
  const last = tally.occurrences.at(-1);
  const examples = (first === last ? [first] : [first, last])
    .filter((record): record is ILogRecord => record !== undefined)
    .slice(0, EXAMPLES_PER_TEMPLATE)
    .map(example);

  return {
    ...counted(tally),
    share: windowSize === 0 ? 0 : round(tally.window / windowSize),
    firstSeen: iso(first?.timestampMs),
    lastSeen: iso(last?.timestampMs),
    confirmedAbsent,
    examples,
  };
}

function example(record: ILogRecord): ILogExample {
  return {
    at: iso(record.timestampMs),
    fields: Object.fromEntries(
      Object.entries(record.fields).map(([meaning, value]) => [meaning, cut(value)]),
    ),
  };
}

function dominant(counts: ReadonlyMap<string, number>): string | null {
  let best: string | null = null;
  let most = 0;

  for (const [value, count] of counts) {
    if (count > most) {
      best = value;
      most = count;
    }
  }
  return best;
}

function cut(value: string): string {
  return value.length <= MAX_MESSAGE_LENGTH ? value : `${value.slice(0, MAX_MESSAGE_LENGTH)}…`;
}

function iso(timestampMs: number | undefined): string {
  return timestampMs === undefined ? '' : new Date(timestampMs).toISOString();
}

function round(value: number): number {
  return Number(value.toPrecision(3));
}
