import type { IIndicatorVertex } from '@heimdall/core/graph';
import type { IndicatorRole } from '@heimdall/core/manifest';
import { CheckKind, CheckTier } from '../enums';
import type { ICheck, ICheckCondition } from '../interfaces';

export type ICheckDraft = Omit<ICheck, 'id'>;

const TIER_ORDER: readonly CheckTier[] = [
  CheckTier.Confirm,
  CheckTier.Localise,
  CheckTier.Explain,
  CheckTier.Corroborate,
  CheckTier.Impact,
];

/**
 * Checks in the order they are added, one per indicator (or per component and step match for
 * logs and traces). A check already planned unconditionally is not planned again; conditional ones
 * accumulate the steps whose failure triggers them.
 */
export class CheckList {
  private readonly drafts: ICheckDraft[] = [];
  private readonly byKey = new Map<string, number>();

  indicator(
    tier: CheckTier,
    indicator: IIndicatorVertex,
    roles: readonly IndicatorRole[],
    rationale: string,
    when?: ICheckCondition,
  ): void {
    this.add({
      tier,
      kind: CheckKind.Indicator,
      subject: indicator.subject,
      indicator,
      roles,
      when,
      rationale,
    });
  }

  add(draft: ICheckDraft): void {
    // Logs and traces are narrowed per step, so the same component can be read several ways.
    const key = [
      draft.kind,
      draft.indicator?.id ?? draft.subject,
      JSON.stringify(draft.match ?? {}),
    ].join('|');
    const index = this.byKey.get(key);
    const existing = index === undefined ? undefined : this.drafts[index];

    if (index === undefined || existing === undefined) {
      this.byKey.set(key, this.drafts.length);
      this.drafts.push(draft);
      return;
    }
    if (existing.when === undefined || draft.when === undefined) {
      return;
    }
    this.drafts[index] = {
      ...existing,
      roles: [...new Set([...existing.roles, ...draft.roles])],
      when: {
        failingSteps: [...new Set([...existing.when.failingSteps, ...draft.when.failingSteps])],
      },
    };
  }

  /** Numbered by tier, keeping the order they were added within one; the cap drops from the end. */
  build(maxChecks: number): { readonly checks: ICheck[]; readonly omitted: number } {
    const kept = [...this.drafts]
      .sort((left, right) => TIER_ORDER.indexOf(left.tier) - TIER_ORDER.indexOf(right.tier))
      .slice(0, maxChecks);

    return {
      checks: kept.map((draft, index) => ({ id: `c${index + 1}`, ...draft })),
      omitted: this.drafts.length - kept.length,
    };
  }
}
