import { z } from 'zod';
import { backendSchema } from './backend.schema';
import { defaultsSchema } from './defaults.schema';
import { querySchema } from './query.schema';
import { redactionSchema } from './redaction.schema';

/** Only version 1 exists. An explicit literal makes a future migration detectable. */
export const CONFIG_VERSION = 1 as const;

function findDuplicates(names: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const duplicated = new Set<string>();

  for (const name of names) {
    if (seen.has(name)) {
      duplicated.add(name);
    }
    seen.add(name);
  }
  return [...duplicated];
}

export const heimdallConfigSchema = z
  .object({
    version: z.literal(CONFIG_VERSION),
    backends: z.array(backendSchema).min(1),
    queries: z.array(querySchema).min(1),
    redaction: redactionSchema.prefault({}),
    defaults: defaultsSchema.prefault({}),
  })
  // Cross-field rules run here rather than at first use, so a typo fails at load
  // time with a path to the offending entry instead of mid-investigation.
  .superRefine((config, ctx) => {
    for (const duplicate of findDuplicates(config.backends.map((b) => b.name))) {
      ctx.addIssue({
        code: 'custom',
        path: ['backends'],
        message: `duplicate backend name '${duplicate}'`,
      });
    }
    for (const duplicate of findDuplicates(config.queries.map((q) => q.name))) {
      ctx.addIssue({
        code: 'custom',
        path: ['queries'],
        message: `duplicate query name '${duplicate}'`,
      });
    }

    const backendNames = new Set(config.backends.map((backend) => backend.name));
    config.queries.forEach((query, index) => {
      if (!backendNames.has(query.backend)) {
        ctx.addIssue({
          code: 'custom',
          path: ['queries', index, 'backend'],
          message: `unknown backend '${query.backend}'; declared backends are ${[...backendNames].join(', ')}`,
        });
      }
    });
  });

export type HeimdallConfig = z.infer<typeof heimdallConfigSchema>;
