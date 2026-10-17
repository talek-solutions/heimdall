import { Test } from '@nestjs/testing';
import { AuthScheme } from '@heimdall/config';
import type { SystemGraph } from '@heimdall/core/graph';
import { LLM_PROVIDER } from '@heimdall/llm';
import type { IInvestigationPlan } from '../interfaces';
import { InvestigationInitService } from '../investigation-init.service';
import { InvestigationModule } from '../investigation.module';
import { CLOCK, INVESTIGATION_CONFIG } from '../investigation.tokens';
import type { IExecutionSources } from '../execution/sources/telemetry-sources.resolver';
import {
  FakeLlmProvider,
  FIXED_CLOCK,
  loadGraph,
  loadManifest,
  ReferenceManifest,
  testConfig,
} from './investigation.fixture';

/** The checkout plan from the init phase, named entry, no model: what execution starts from. */
export async function checkoutPlan(): Promise<{ plan: IInvestigationPlan; graph: SystemGraph }> {
  const moduleRef = await Test.createTestingModule({ imports: [InvestigationModule] })
    .overrideProvider(LLM_PROVIDER)
    .useValue(new FakeLlmProvider([]))
    .overrideProvider(INVESTIGATION_CONFIG)
    .useValue(testConfig())
    .overrideProvider(CLOCK)
    .useValue(FIXED_CLOCK)
    .compile();
  const plan = await moduleRef
    .get(InvestigationInitService)
    .prepare(await loadManifest(ReferenceManifest.Checkout), {
      query: 'checkouts are not working',
      entry: 'functionality:checkout',
    });

  return { plan, graph: await loadGraph(ReferenceManifest.Checkout) };
}

const PLACEHOLDER = { url: 'x', timeoutMs: 1, auth: { scheme: AuthScheme.None } } as const;

/** Sources for specs that never reach a backend. */
export const PLACEHOLDER_SOURCES: IExecutionSources = {
  metrics: PLACEHOLDER,
  logs: { ok: true, source: PLACEHOLDER },
  traces: { ok: true, source: PLACEHOLDER },
};
