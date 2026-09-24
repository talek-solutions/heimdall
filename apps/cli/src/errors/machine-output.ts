import { OutputFormat } from '@heimdall/core';

const MACHINE_FORMATS: ReadonlySet<string> = new Set([OutputFormat.Json, OutputFormat.Ndjson]);
const OUTPUT_FLAG = '--output';

// For failures before commander has parsed options, e.g. a provider throwing at bootstrap.
export function argvRequestsMachineOutput(argv: readonly string[]): boolean {
  return argv.some((arg, index) => {
    if (arg === '--json' || arg === '--ndjson') {
      return true;
    }
    if (arg.startsWith(`${OUTPUT_FLAG}=`)) {
      return MACHINE_FORMATS.has(arg.slice(OUTPUT_FLAG.length + 1));
    }
    return arg === OUTPUT_FLAG && MACHINE_FORMATS.has(argv[index + 1] ?? '');
  });
}
