import { Injectable } from '@nestjs/common';
import type { IComponentVertex, ISemanticSelector } from '@heimdall/core/graph';
import type { ILogRecord } from '@heimdall/telemetry';
import { InvestigationErrorCode } from '../../errors';
import type { ICheckProblem } from '../checks/check-result.interface';

export interface ICompiledLogs {
  /** The stream selector, and a line filter when one was asked for. */
  readonly query: string;
  /** Raw field key → meaning: the allowlist the source applies. */
  readonly fields: Readonly<Record<string, string>>;
  /** The step's match meanings the component maps a field to. */
  readonly narrowedBy: Readonly<Record<string, string>>;
  readonly ignored: readonly string[];
}

export type LogsCompilation =
  | { readonly ok: true; readonly compiled: ICompiledLogs }
  | ({ readonly ok: false } & ICheckProblem);

/**
 * LogQL from a component's telemetry identity (ADR 0018): its stream selector, plus a literal line
 * filter for `search_logs`. No parser stages: lines are parsed in code, after the allowlist, the
 * same way on a fixture as on Loki.
 */
@Injectable()
export class LogQlCompiler {
  compile(
    component: IComponentVertex,
    options: {
      readonly match?: ISemanticSelector | undefined;
      readonly contains?: string | undefined;
    },
  ): LogsCompilation {
    const logs = component.telemetry.logs;

    if (logs === undefined) {
      return {
        ok: false,
        errorCode: InvestigationErrorCode.NoLogsIdentity,
        message: `${component.id} declares no telemetry.logs`,
      };
    }
    const meanings = new Set(Object.values(logs.fields));
    const match = Object.entries(options.match ?? {});

    return {
      ok: true,
      compiled: {
        query:
          options.contains === undefined
            ? logs.selector
            : `${logs.selector} |= ${quote(options.contains)}`,
        fields: logs.fields,
        narrowedBy: Object.fromEntries(match.filter(([meaning]) => meanings.has(meaning))),
        ignored: match.map(([meaning]) => meaning).filter((meaning) => !meanings.has(meaning)),
      },
    };
  }

  /** The base query, narrowed to lines holding a template's literal text, spaces as `\s+`. */
  confirmation(query: string, literal: string): string | undefined {
    if (literal.includes('`')) {
      return undefined;
    }
    const pattern = literal
      .split(' ')
      .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('\\s+');

    return `${query} |~ \`${pattern}\``;
  }
}

/**
 * A step's match keeps the lines that agree with it and drops the ones that contradict it: a line
 * without the field says nothing about the step, so it stays.
 */
export function narrow(
  records: readonly ILogRecord[],
  narrowedBy: Readonly<Record<string, string>>,
): ILogRecord[] {
  const conditions = Object.entries(narrowedBy);

  return records.filter((record) =>
    conditions.every(([meaning, value]) => {
      const found = record.fields[meaning];
      return found === undefined || found === value;
    }),
  );
}

function quote(literal: string): string {
  return `"${literal.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
