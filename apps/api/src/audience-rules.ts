export const REPURCHASE_CYCLE = {
  cat_litter: 21,
  cat_food: 30,
  dog_food: 30,
  treats: 14,
} as const;

export type RepurchaseCategory = keyof typeof REPURCHASE_CYCLE;

export function inDormantWindow(days: number) {
  return days >= 60;
}

export function inRepurchaseWindow(category: string, days: number) {
  const cycle = REPURCHASE_CYCLE[category as RepurchaseCategory];
  if (!cycle) return false;
  return days >= cycle - 7 && days <= cycle + 7;
}

export function inFirstOrderWindow(orderCount: number, days: number) {
  return orderCount === 1 && days >= 7 && days <= 30;
}

export function inAbandonedWindow(days: number) {
  return days >= 1 && days <= 7;
}

export function cohortKey(input: {
  language: string;
  country: string | null;
  scenario: string;
  spendTier: string;
  topCategory: string | null;
}) {
  return [input.language, input.country || '', input.scenario, input.spendTier, input.topCategory || ''].join('|');
}

export function quoteCost(personalized: number, groups: number) {
  const calls = personalized + groups;
  const raw = process.env.UNIT_PRICE_CENTS;
  if (raw == null || !/^\d+$/.test(raw.trim())) {
    return { calls, unitPriceCents: null as number | null, costCents: null as number | null, configured: false };
  }
  const unitPriceCents = Number(raw.trim());
  return { calls, unitPriceCents, costCents: calls * unitPriceCents, configured: true };
}
