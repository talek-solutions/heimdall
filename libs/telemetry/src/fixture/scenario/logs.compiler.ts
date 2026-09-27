import type { ICurve } from '../engine/curve';
import { hashString } from '../engine/deterministic-random';
import { compileTemplate } from '../loki/log-template';
import { compileCurve, type ICurveContext } from './curve.compiler';
import { ScenarioFile } from './scenario.enums';
import type { ILogs, ILogStream, ILokiSeries } from './scenario.model';
import type { LogsFileSchema, LogStreamSchema, LokiSeriesSchema } from './schema/logs.schema';

/** Matches every query: a stream without a `match` answers any log query its labels satisfy. */
const MATCH_ANY = '(?:)';

export interface ILogsCompilerContext extends ICurveContext {
  compilePattern(pattern: string, path: string): RegExp;
  hasTraceTemplate(id: string): boolean;
}

export function compileLogs(file: LogsFileSchema, context: ILogsCompilerContext): ILogs {
  reportDuplicates(file.streams.map((stream) => stream.id), 'streams', context.issues);
  reportDuplicates(file.series.map((series) => series.id), 'series', context.issues);

  return {
    streams: file.streams.map((stream, index) =>
      compileStream(stream, `${ScenarioFile.Logs}: streams.${index}`, context),
    ),
    series: file.series.map((series, index) =>
      compileSeries(series, `${ScenarioFile.Logs}: series.${index}`, context),
    ),
  };
}

function compileStream(spec: LogStreamSchema, path: string, context: ILogsCompilerContext): ILogStream {
  const key = `logs:streams:${spec.id}`;

  if (Object.keys(spec.labels).length === 0) {
    context.issues.push(`${path}.labels: a Loki stream needs at least one label`);
  }
  return {
    id: spec.id,
    key: hashString(key),
    match: context.compilePattern(spec.match ?? MATCH_ANY, `${path}.match`),
    labels: spec.labels,
    rate: compileCurve(spec.rate, `${key}:rate`, `${path}.rate`, context),
    templates: spec.templates.map((template, index) => ({
      weight: compileCurve(template.weight, `${key}:templates:${index}`, `${path}.templates.${index}.weight`, context),
      segments: compileTemplate(template.line, `${path}.templates.${index}.line`, {
        issues: context.issues,
        resolveRef: (id, refPath): ICurve | undefined => context.resolveRef(id, refPath),
        hasTraceTemplate: (id) => context.hasTraceTemplate(id),
      }),
    })),
  };
}

function compileSeries(spec: LokiSeriesSchema, path: string, context: ILogsCompilerContext): ILokiSeries {
  return {
    id: spec.id,
    scaleByRange: spec.scaleByRange,
    match: context.compilePattern(spec.match, `${path}.match`),
    labels: spec.labels,
    curve: compileCurve(spec.curve, `logs:series:${spec.id}`, `${path}.curve`, context),
  };
}

function reportDuplicates(ids: readonly string[], field: string, issues: string[]): void {
  const seen = new Set<string>();

  for (const [index, id] of ids.entries()) {
    if (seen.has(id)) {
      issues.push(`${ScenarioFile.Logs}: ${field}.${index}.id: duplicate id '${id}'`);
    }
    seen.add(id);
  }
}
