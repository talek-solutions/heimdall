import { ToolResultStatus } from '../enums';
import type { IToolResult } from './agent-tool.interface';

export function toolOk(content: unknown, summary: string, cost = 0): IToolResult {
  return { status: ToolResultStatus.Ok, content, summary, cost };
}

/** `{ errorCode, message }`, the error shape every Heimdall surface shares. */
export function toolError(errorCode: string, message: string, cost = 0): IToolResult {
  return {
    status: ToolResultStatus.Error,
    content: { errorCode, message },
    summary: errorCode,
    cost,
  };
}
