import { z } from 'zod';
import { Scrubber } from '../../domain/enums';

const ALL_SCRUBBERS: readonly Scrubber[] = Object.values(Scrubber);

export const redactionSchema = z.object({
  /** Defaults to every scrubber: opting OUT must be deliberate, never accidental. */
  scrubbers: z.array(z.enum(Scrubber)).default([...ALL_SCRUBBERS]),
  additionalPatterns: z
    .array(
      z.object({
        name: z.string().min(1),
        pattern: z.string().min(1),
      }),
    )
    .default([]),
});

export type RedactionConfig = z.infer<typeof redactionSchema>;
