import { TelemetryError, TelemetryErrorCode } from '../../errors';
import type { ICurve } from '../engine/curve';
import { hashString } from '../engine/deterministic-random';
import { parseDuration } from '../engine/duration';
import { compileCurve, type ICurveContext } from './curve.compiler';
import { compileLogs } from './logs.compiler';
import { ScenarioFile } from './scenario.enums';
import type { IMetricSeries, IScenario } from './scenario.model';
import type { LogsFileSchema } from './schema/logs.schema';
import type { TracesFileSchema } from './schema/traces.schema';
import { compileTraces } from './traces.compiler';
import type { MetricsFileSchema, MetricSeriesSchema } from './schema/metrics.schema';
import type { ScenarioManifestSchema } from './schema/scenario-manifest.schema';

const MAX_REPORTED_ISSUES = 10;

export interface IScenarioDocuments {
  readonly name: string;
  readonly contentHash: string;
  readonly manifest: ScenarioManifestSchema;
  readonly metrics: MetricsFileSchema;
  readonly logs: LogsFileSchema;
  readonly traces: TracesFileSchema;
}

/** Cross-field rules, regexes and `ref`s. Every issue is reported at once, as the config parser does. */
export function compileScenario(documents: IScenarioDocuments): IScenario {
  const issues: string[] = [];
  const durationMs = positiveDuration(documents.manifest.duration, 'duration', issues);
  const resolutionMs = positiveDuration(documents.manifest.resolution, 'resolution', issues);
  const seed = documents.manifest.seed ?? hashString(documents.name);
  const patterns = new PatternCache(issues);
  const metricCompiler = new MetricSeriesCompiler(documents.metrics.series, patterns, {
    seed,
    durationMs,
    resolutionMs,
    issues,
  });
  const metrics = metricCompiler.compileAll();
  // Other signals may only `ref` metric series, never each other.
  const signalContext = {
    seed,
    durationMs,
    resolutionMs,
    issues,
    resolveRef: (id: string, path: string) => metricCompiler.resolve(id, path),
    compilePattern: (pattern: string, path: string) => patterns.compile(pattern, path),
  };
  const traces = compileTraces(documents.traces, signalContext);
  const traceIds = new Set(traces.map((trace) => trace.id));
  const logs = compileLogs(documents.logs, {
    ...signalContext,
    hasTraceTemplate: (id) => traceIds.has(id),
  });

  if (issues.length > 0) {
    throw invalidScenario(documents.name, issues);
  }
  return {
    name: documents.name,
    seed,
    durationMs,
    resolutionMs,
    contentHash: documents.contentHash,
    metrics,
    logs,
    traces,
  };
}

export function invalidScenario(name: string, issues: readonly string[]): TelemetryError {
  const reported = issues.slice(0, MAX_REPORTED_ISSUES);
  const omitted = issues.length - reported.length;
  const detail = omitted > 0 ? `${reported.join('; ')} (and ${omitted} more)` : reported.join('; ');

  return new TelemetryError(TelemetryErrorCode.FixtureScenarioInvalid, `scenario '${name}': ${detail}`);
}

/** Candidates with the same pattern share one `RegExp`, which is how the query matcher groups them. */
export class PatternCache {
  private readonly compiled = new Map<string, RegExp>();

  constructor(private readonly issues: string[]) {}

  public compile(pattern: string, path: string): RegExp {
    const cached = this.compiled.get(pattern);

    if (cached !== undefined) {
      return cached;
    }
    try {
      const regex = new RegExp(pattern);
      this.compiled.set(pattern, regex);
      return regex;
    } catch (error) {
      this.issues.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
      return /(?!)/;
    }
  }
}

/** Metric series may `ref` each other; resolution is memoised and cycle-checked. */
class MetricSeriesCompiler {
  private readonly specs = new Map<string, { spec: MetricSeriesSchema; index: number }>();
  private readonly curves = new Map<string, ICurve>();
  private readonly resolving = new Set<string>();

  constructor(
    private readonly series: readonly MetricSeriesSchema[],
    private readonly patterns: PatternCache,
    private readonly context: Omit<ICurveContext, 'resolveRef'>,
  ) {
    for (const [index, spec] of series.entries()) {
      if (this.specs.has(spec.id)) {
        context.issues.push(`${ScenarioFile.Metrics}: series.${index}.id: duplicate id '${spec.id}'`);
      } else {
        this.specs.set(spec.id, { spec, index });
      }
    }
  }

  public compileAll(): IMetricSeries[] {
    return this.series.map((spec, index) => ({
      id: spec.id,
      match: this.patterns.compile(spec.match, `${ScenarioFile.Metrics}: series.${index}.match`),
      labels: spec.labels,
      curve: this.resolve(spec.id, `${ScenarioFile.Metrics}: series.${index}`) ?? { valueAt: () => 0 },
    }));
  }

  /** Also serves `ref`s from other signal files, which may only point at metric series. */
  public resolve(id: string, path: string): ICurve | undefined {
    const cached = this.curves.get(id);

    if (cached !== undefined) {
      return cached;
    }
    const entry = this.specs.get(id);

    if (entry === undefined) {
      this.context.issues.push(`${path}: unknown metric series '${id}'`);
      return undefined;
    }
    if (this.resolving.has(id)) {
      this.context.issues.push(`${path}: ref cycle through '${id}'`);
      return undefined;
    }
    this.resolving.add(id);
    const curve = compileCurve(
      entry.spec.curve,
      `metrics:${id}`,
      `${ScenarioFile.Metrics}: series.${entry.index}.curve`,
      { ...this.context, resolveRef: (target, refPath) => this.resolve(target, refPath) },
    );
    this.resolving.delete(id);
    this.curves.set(id, curve);
    return curve;
  }
}

function positiveDuration(value: string, field: string, issues: string[]): number {
  const millis = parseDuration(value) ?? 0;

  if (millis <= 0) {
    issues.push(`${ScenarioFile.Manifest}: ${field}: must be longer than zero`);
    return 1;
  }
  return millis;
}
