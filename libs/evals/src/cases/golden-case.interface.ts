import type { ConclusionOutcome } from '@heimdall/investigation';

/** What an engineer who knows the incident says the right answer is. */
export interface IReferenceAnswer {
  readonly outcome: ConclusionOutcome;
  /** The step the fault starts at; absent when there is no fault. */
  readonly origin?: string | undefined;
  /** The vertex at fault; absent when there is no fault. */
  readonly cause?: string | undefined;
  readonly mechanism: string;
  /** What the evidence should show, in words. */
  readonly evidence: readonly string[];
}

/** One known incident (`.docs/design/replay-and-evals.md`, Golden cases). */
export interface IGoldenCase {
  readonly name: string;
  readonly description: string;
  /** Absolute, resolved from the case file. */
  readonly manifest: string;
  readonly scenario: string;
  readonly anchor: string;
  readonly query: string;
  readonly since: string;
  readonly entry?: string | undefined;
  readonly environment?: string | undefined;
  /** `INVESTIGATION_*` or `AGENT_*` overrides for this case. */
  readonly env: Readonly<Record<string, string>>;
  readonly reference: IReferenceAnswer;
}
