import { Injectable } from '@nestjs/common';
import type { IComponentVertex, ISemanticSelector } from '@heimdall/core/graph';
import { InteractionMode, LabelSemantic } from '@heimdall/core/manifest';
import { TempoSpanKind } from '@heimdall/telemetry';
import { HopSide } from '../../enums';
import { InvestigationErrorCode } from '../../errors';
import type { ICheckProblem } from '../checks/check-result.interface';

export interface ITraceQlOptions {
  readonly side?: HopSide | undefined;
  readonly mode?: InteractionMode | undefined;
  readonly match?: ISemanticSelector | undefined;
  /** An exact span name. */
  readonly operation?: string | undefined;
  readonly errorsOnly: boolean;
}

export interface ICompiledTraces {
  readonly query: string;
  readonly narrowedBy: Readonly<Record<string, string>>;
  readonly ignored: readonly string[];
}

export type TracesCompilation =
  | { readonly ok: true; readonly compiled: ICompiledTraces }
  | ({ readonly ok: false } & ICheckProblem);

interface ISpanAttribute {
  readonly attribute: string;
  /** The ends of a hop whose spans carry the attribute. */
  readonly sides: readonly HopSide[];
  readonly numeric?: boolean;
}

const BOTH = [HopSide.Caller, HopSide.Target] as const;

/** A step's match meanings as OpenTelemetry attributes, and which end of a hop records them. */
const SPAN_ATTRIBUTES: Readonly<Record<LabelSemantic, ISpanAttribute | undefined>> = {
  [LabelSemantic.Route]: { attribute: 'span.http.route', sides: [HopSide.Target] },
  [LabelSemantic.Method]: { attribute: 'span.http.request.method', sides: BOTH },
  [LabelSemantic.StatusCode]: {
    attribute: 'span.http.response.status_code',
    sides: BOTH,
    numeric: true,
  },
  [LabelSemantic.Outcome]: undefined,
  [LabelSemantic.Operation]: { attribute: 'span.db.operation.name', sides: [HopSide.Caller] },
  [LabelSemantic.Table]: { attribute: 'span.db.collection.name', sides: [HopSide.Caller] },
  [LabelSemantic.Topic]: { attribute: 'span.messaging.destination.name', sides: BOTH },
  [LabelSemantic.ConsumerGroup]: {
    attribute: 'span.messaging.consumer.group.name',
    sides: [HopSide.Target],
  },
  [LabelSemantic.Instance]: { attribute: 'resource.service.instance.id', sides: BOTH },
};

const KINDS: Readonly<Record<HopSide, Readonly<Record<InteractionMode, TempoSpanKind>>>> = {
  [HopSide.Caller]: {
    [InteractionMode.Sync]: TempoSpanKind.Client,
    [InteractionMode.Async]: TempoSpanKind.Producer,
  },
  [HopSide.Target]: {
    [InteractionMode.Sync]: TempoSpanKind.Server,
    [InteractionMode.Async]: TempoSpanKind.Consumer,
  },
};

const NUMBER = /^\d+$/;
const ERROR_STATUS = 'status = error';

/**
 * TraceQL from a component's telemetry identity (ADR 0018). Around a hop, only the spans of the
 * subject's end of it: the caller's client (or producer) spans, the target's server (or consumer)
 * spans, each narrowed by the match meanings that end records.
 */
@Injectable()
export class TraceQlCompiler {
  compile(component: IComponentVertex, options: ITraceQlOptions): TracesCompilation {
    const traces = component.telemetry.traces;

    if (traces === undefined) {
      return {
        ok: false,
        errorCode: InvestigationErrorCode.NoTracesIdentity,
        message: `${component.id} declares no telemetry.traces`,
      };
    }
    const conditions = [`resource.service.name = ${quote(traces.serviceName)}`];
    const narrowedBy: Record<string, string> = {};
    const ignored: string[] = [];

    if (options.side !== undefined) {
      conditions.push(`kind = ${KINDS[options.side][options.mode ?? InteractionMode.Sync]}`);
    }
    for (const [meaning, value] of Object.entries(options.match ?? {})) {
      const mapped = SPAN_ATTRIBUTES[meaning as LabelSemantic];
      const applies =
        mapped !== undefined &&
        (options.side === undefined || mapped.sides.includes(options.side)) &&
        (mapped.numeric !== true || NUMBER.test(value));

      if (!applies) {
        ignored.push(meaning);
        continue;
      }
      conditions.push(`${mapped.attribute} = ${mapped.numeric === true ? value : quote(value)}`);
      narrowedBy[meaning] = value;
    }
    if (options.operation !== undefined) {
      conditions.push(`name = ${quote(options.operation)}`);
    }
    if (options.errorsOnly) {
      conditions.push(ERROR_STATUS);
    }
    return { ok: true, compiled: { query: `{ ${conditions.join(' && ')} }`, narrowedBy, ignored } };
  }

  /** The same query, for error spans only. */
  errors(query: string): string {
    return query.includes(ERROR_STATUS) ? query : query.replace(/ }$/, ` && ${ERROR_STATUS} }`);
  }
}

function quote(literal: string): string {
  return `"${literal.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
