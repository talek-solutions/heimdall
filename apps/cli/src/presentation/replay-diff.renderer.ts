import { ReplayOutcome, type IReplayDiff, type IValueChange } from '@heimdall/transcript';

const SHOWN = 3;

/** The comparison for a terminal: what matched, and the first few places that did not. */
export function renderReplayDiff(file: string, diff: IReplayDiff): string {
  const { modelCalls, modelInputs, toolResults, telemetry, report } = diff;
  const lines = [
    `replay        ${file}`,
    `model calls   ${modelCalls.recorded} recorded · ${modelCalls.replayed} replayed`,
    `model inputs  ${modelInputs.length === 0 ? 'identical' : `differ at call ${modelInputs.map(({ call }) => call).join(', ')}${diff.strict ? '' : ' (reported only; --strict fails on it)'}`}`,
    ...modelInputs.slice(0, SHOWN).flatMap(({ call, changes }) => details(`call ${call}`, changes)),
    `tool results  ${toolResults.compared} compared · ${toolResults.differing.length === 0 ? 'identical' : `${toolResults.differing.length} differ`}`,
    ...toolResults.differing
      .slice(0, SHOWN)
      .flatMap(({ callId, tool, changes }) =>
        details(`${callId}${tool === null ? '' : ` ${tool}`}`, changes),
      ),
    `telemetry     ${telemetry.compared} compared · ${telemetry.missing.length === 0 && telemetry.extra.length === 0 ? 'identical' : `${telemetry.missing.length} not asked again, ${telemetry.extra.length} never recorded`}`,
    ...[
      ...telemetry.missing.map((call) => `- ${call}`),
      ...telemetry.extra.map((call) => `+ ${call}`),
    ]
      .slice(0, SHOWN)
      .map((call) => `                ${call}`),
    `report        ${report.length === 0 ? 'identical' : `${report.length} differences`}`,
    ...details('', report),
    diff.outcome === ReplayOutcome.Matched ? 'MATCHED' : 'DIVERGED (exit 6)',
  ];

  return `${lines.join('\n')}\n`;
}

function details(label: string, changes: readonly IValueChange[]): string[] {
  return changes
    .slice(0, SHOWN)
    .map(
      ({ path, recorded, replayed }) =>
        `                ${label === '' ? '' : `${label}: `}${path === '' ? '(value)' : path}  ${recorded} → ${replayed}`,
    );
}
