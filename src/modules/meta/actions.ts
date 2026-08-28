import {
  ADD_TO_CART_ACTION_TYPES,
  CHECKOUT_ACTION_TYPES,
  INSTANT_EXPERIENCE_ACTION_TYPES,
  LANDING_PAGE_VIEW_ACTION_TYPES,
  MESSAGING_ACTION_TYPES,
  PURCHASE_ACTION_TYPES,
  REGISTRATION_ACTION_TYPES,
  WEBSITE_PURCHASE_ACTION_TYPES,
} from "./constants";
import type { MetaAction } from "./types";

export function sumMatchingActions(
  actions: MetaAction[] | undefined,
  actionTypes: readonly string[]
): number | null {
  if (!actions || !Array.isArray(actions)) return null;
  let total = 0;
  let matched = false;
  for (const action of actions) {
    if (action.action_type && actionTypes.includes(action.action_type)) {
      total += Number(action.value || 0);
      matched = true;
    }
  }
  return matched ? total : null;
}

export function firstActionValue(actions: MetaAction[] | undefined): number | null {
  if (!actions || !Array.isArray(actions) || actions.length === 0) return null;
  return toNumberOrNull(actions[0]?.value);
}

export function firstRoasValue(roas: MetaAction[] | undefined): number | null {
  return firstActionValue(roas);
}

export function toNumberOrNull(value: unknown): number | null {
  if (value === "" || value === null || value === undefined) return null;
  if (Array.isArray(value)) return firstActionValue(value as MetaAction[]);
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function toBigIntOrNull(value: unknown): number | null {
  const number = toNumberOrNull(value);
  if (number == null) return null;
  return Math.trunc(number);
}

export function normalizeAllActions(
  actions: MetaAction[] | undefined
): Array<{ action_type: string; value: number | null }> {
  if (!actions || !Array.isArray(actions)) return [];
  const byType = new Map<string, number>();
  for (const action of actions) {
    if (!action.action_type) continue;
    const current = byType.get(action.action_type) ?? 0;
    byType.set(action.action_type, current + Number(action.value || 0));
  }
  return [...byType.entries()].map(([action_type, value]) => ({
    action_type,
    value,
  }));
}

export function mapParityActions(row: {
  actions?: MetaAction[];
  action_values?: MetaAction[];
}) {
  return {
    purchases: sumMatchingActions(row.actions, PURCHASE_ACTION_TYPES),
    websitePurchases: sumMatchingActions(row.actions, WEBSITE_PURCHASE_ACTION_TYPES),
    purchaseValue: sumMatchingActions(row.action_values, PURCHASE_ACTION_TYPES),
    addsToCart: sumMatchingActions(row.actions, ADD_TO_CART_ACTION_TYPES),
    checkoutsInitiated: sumMatchingActions(row.actions, CHECKOUT_ACTION_TYPES),
    checkoutsInitiatedValue: sumMatchingActions(row.action_values, CHECKOUT_ACTION_TYPES),
    landingPageViews: sumMatchingActions(row.actions, LANDING_PAGE_VIEW_ACTION_TYPES),
    messagingConversationsStarted: sumMatchingActions(row.actions, MESSAGING_ACTION_TYPES),
    registrationsCompleted: sumMatchingActions(row.actions, REGISTRATION_ACTION_TYPES),
    instantExperienceViewPercentage: sumMatchingActions(
      row.actions,
      INSTANT_EXPERIENCE_ACTION_TYPES
    ),
  };
}

export function safeRatio(numerator: number | null, denominator: number | null): number | null {
  if (numerator == null || denominator == null) return null;
  if (denominator === 0) return null;
  const result = numerator / denominator;
  return Number.isFinite(result) ? result : null;
}
