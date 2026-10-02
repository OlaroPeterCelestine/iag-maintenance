/** CEO desk dashboard widget layout — memory + Postgres (not localStorage). */

import { getMemorySetting, setMemorySetting } from "@/lib/db/client-store";
import { persistSettingToDb } from "@/lib/db/sync";

export const CEO_DESK_WIDGETS_KEY = "financeiag-ceo-desk-widgets-v1";

export const BUSINESS_WIDGET_IDS = [
  "cash-bank",
  "net-profit",
  "receivable",
  "payable",
  "assets",
  "liabilities",
  "working-capital",
  "stalled-projects",
] as const;

export const ACTION_WIDGET_IDS = [
  "in-approval",
  "overdue-urgent",
  "documents",
  "ready-finance",
] as const;

export type BusinessWidgetId = (typeof BUSINESS_WIDGET_IDS)[number];
export type ActionWidgetId = (typeof ACTION_WIDGET_IDS)[number];

export type CeoDeskWidgetLayout = {
  business: BusinessWidgetId[];
  action: ActionWidgetId[];
};

export const DEFAULT_CEO_DESK_WIDGETS: CeoDeskWidgetLayout = {
  business: [...BUSINESS_WIDGET_IDS],
  action: [...ACTION_WIDGET_IDS],
};

function isBusinessId(value: unknown): value is BusinessWidgetId {
  return typeof value === "string" && (BUSINESS_WIDGET_IDS as readonly string[]).includes(value);
}

function isActionId(value: unknown): value is ActionWidgetId {
  return typeof value === "string" && (ACTION_WIDGET_IDS as readonly string[]).includes(value);
}

function uniquePreserveOrder<T extends string>(ids: T[]): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function normalize(layout: Partial<CeoDeskWidgetLayout> | null | undefined): CeoDeskWidgetLayout {
  const business = Array.isArray(layout?.business)
    ? layout.business.filter(isBusinessId)
    : DEFAULT_CEO_DESK_WIDGETS.business;
  const action = Array.isArray(layout?.action)
    ? layout.action.filter(isActionId)
    : DEFAULT_CEO_DESK_WIDGETS.action;
  return {
    business: uniquePreserveOrder(business),
    action: uniquePreserveOrder(action),
  };
}

export function loadCeoDeskWidgets(): CeoDeskWidgetLayout {
  if (typeof window === "undefined") return DEFAULT_CEO_DESK_WIDGETS;
  try {
    const stored = getMemorySetting<Partial<CeoDeskWidgetLayout> | null>(
      CEO_DESK_WIDGETS_KEY,
      null,
    );
    if (stored) return normalize(stored);

    // Discard leftover LS — never import into Postgres.
    try {
      localStorage.removeItem(CEO_DESK_WIDGETS_KEY);
    } catch {
      /* ignore */
    }

    return DEFAULT_CEO_DESK_WIDGETS;
  } catch {
    return DEFAULT_CEO_DESK_WIDGETS;
  }
}

export function saveCeoDeskWidgets(layout: CeoDeskWidgetLayout) {
  if (typeof window === "undefined") return;
  const next = normalize(layout);
  setMemorySetting(CEO_DESK_WIDGETS_KEY, next);
  void persistSettingToDb(CEO_DESK_WIDGETS_KEY, next);
}
