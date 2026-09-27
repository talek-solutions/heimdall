import { hashString } from '../engine/deterministic-random';
import { compileCurve, type ICurveContext } from './curve.compiler';
import { ScenarioFile } from './scenario.enums';
import type { ISpanTemplate, ITraceTemplate } from './scenario.model';
import type { SpanSchema, TracesFileSchema, TraceTemplateSchema } from './schema/traces.schema';

const MATCH_ANY = '(?:)';
/** Trace IDs carry the template index in 16 bits. */
const MAX_TRACE_TEMPLATES = 0xffff;

export interface ITracesCompilerContext extends ICurveContext {
  compilePattern(pattern: string, path: string): RegExp;
}

export function compileTraces(file: TracesFileSchema, context: ITracesCompilerContext): ITraceTemplate[] {
  const seen = new Set<string>();

  if (file.traces.length > MAX_TRACE_TEMPLATES) {
    context.issues.push(`${ScenarioFile.Traces}: traces: at most ${MAX_TRACE_TEMPLATES} templates`);
  }
  return file.traces.map((spec, index) => {
    const path = `${ScenarioFile.Traces}: traces.${index}`;

    if (seen.has(spec.id)) {
      context.issues.push(`${path}.id: duplicate id '${spec.id}'`);
    }
    seen.add(spec.id);
    return compileTemplate(spec, index, path, context);
  });
}

function compileTemplate(
  spec: TraceTemplateSchema,
  index: number,
  path: string,
  context: ITracesCompilerContext,
): ITraceTemplate {
  const key = `traces:${spec.id}`;
  const root = compileSpan(spec.root, `${key}:root`, `${path}.root`, context);

  return {
    id: spec.id,
    index,
    key: hashString(key),
    match: context.compilePattern(spec.match ?? MATCH_ANY, `${path}.match`),
    labels: {},
    rate: compileCurve(spec.rate, `${key}:rate`, `${path}.rate`, context),
    duration: compileCurve(spec.duration, `${key}:duration`, `${path}.duration`, context),
    errorDuration:
      spec.errorDuration === undefined
        ? undefined
        : compileCurve(spec.errorDuration, `${key}:errorDuration`, `${path}.errorDuration`, context),
    jitter: spec.jitter,
    error: compileCurve(spec.error, `${key}:error`, `${path}.error`, context),
    root,
    errorSources: errorSources(root),
  };
}

function compileSpan(spec: SpanSchema, key: string, path: string, context: ITracesCompilerContext): ISpanTemplate {
  return {
    service: spec.service,
    name: spec.name,
    kind: spec.kind,
    attributes: spec.attributes,
    errorAttributes: spec.errorAttributes,
    share: compileCurve(spec.share, `${key}:share`, `${path}.share`, context),
    errorSource: spec.errorSource,
    errorMessage: spec.errorMessage,
    children: spec.children.map((child, index) =>
      compileSpan(child, `${key}:${index}`, `${path}.children.${index}`, context),
    ),
  };
}

function errorSources(root: ISpanTemplate): ISpanTemplate[] {
  const marked: ISpanTemplate[] = [];
  const visit = (span: ISpanTemplate): void => {
    if (span.errorSource) {
      marked.push(span);
    }
    span.children.forEach(visit);
  };
  visit(root);
  return marked.length === 0 ? [root] : marked;
}
