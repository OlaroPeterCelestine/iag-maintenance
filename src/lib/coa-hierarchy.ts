import type { ManagerRecord } from "@/lib/manager-entities";

export const COA_ROOT_TYPES = ["Asset", "Liability", "Equity", "Income", "Expense"] as const;

export function isCoaGroup(record: Partial<ManagerRecord> | null | undefined) {
  return (record?.kind || "").toLowerCase() === "group";
}

export function isCoaAccount(record: Partial<ManagerRecord> | null | undefined) {
  const kind = (record?.kind || "Account").toLowerCase();
  return kind === "account" || kind === "";
}

export function coaGroupName(record: ManagerRecord) {
  return (record.name || "").trim();
}

/** All group records (kind = Group). */
export function listCoaGroups(records: ManagerRecord[]) {
  return records.filter(isCoaGroup);
}

/** Unique group names available for assignment (from Group records + account.group values). */
export function coaGroupOptions(records: ManagerRecord[]): string[] {
  const names = new Set<string>();
  for (const r of records) {
    if (isCoaGroup(r) && r.name?.trim()) names.add(r.name.trim());
    if (isCoaAccount(r) && r.group?.trim()) names.add(r.group.trim());
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

function groupByName(records: ManagerRecord[]) {
  const map = new Map<string, ManagerRecord>();
  for (const g of listCoaGroups(records)) {
    const n = coaGroupName(g);
    if (n) map.set(n.toLowerCase(), g);
  }
  return map;
}

/** Depth of a group in the subgroup tree (0 = top-level). */
export function coaGroupDepth(records: ManagerRecord[], groupName: string, seen = new Set<string>()): number {
  const key = groupName.trim().toLowerCase();
  if (!key || seen.has(key)) return 0;
  seen.add(key);
  const g = groupByName(records).get(key);
  const parent = (g?.parentGroup || "").trim();
  if (!parent) return 0;
  return 1 + coaGroupDepth(records, parent, seen);
}

export function coaGroupPath(records: ManagerRecord[], groupName: string): string {
  const parts: string[] = [];
  let current = groupName.trim();
  const seen = new Set<string>();
  while (current && !seen.has(current.toLowerCase())) {
    seen.add(current.toLowerCase());
    parts.unshift(current);
    const g = groupByName(records).get(current.toLowerCase());
    current = (g?.parentGroup || "").trim();
  }
  return parts.join(" › ");
}

/**
 * Ensure every account.group has a matching Group record so subgroups can be nested under them.
 * Returns records unchanged if nothing to add; otherwise a new array with synthetic groups prepended.
 */
export function ensureCoaGroupRecords(records: ManagerRecord[]): ManagerRecord[] {
  const existing = new Set(
    listCoaGroups(records).map((g) => coaGroupName(g).toLowerCase()).filter(Boolean),
  );
  const missing = new Map<string, { name: string; type: string }>();
  for (const r of records) {
    if (!isCoaAccount(r)) continue;
    const g = (r.group || "").trim();
    if (!g || existing.has(g.toLowerCase()) || missing.has(g.toLowerCase())) continue;
    missing.set(g.toLowerCase(), { name: g, type: r.type || "Asset" });
  }
  if (!missing.size) return records;
  const now = new Date().toISOString();
  const added: ManagerRecord[] = [...missing.values()].map((m) => ({
    id: `group-${m.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    kind: "Group",
    name: m.name,
    code: "",
    type: m.type,
    parentGroup: "",
    group: "",
    openingBalance: "",
    balance: "",
    status: "Active",
    createdAt: now,
    updatedAt: now,
  }));
  return [...added, ...records];
}

/**
 * Order CoA for display: by type, then tree of groups (parent before children),
 * with accounts listed under their group.
 */
export function sortCoaHierarchy(records: ManagerRecord[]): ManagerRecord[] {
  const typeOrder = new Map(COA_ROOT_TYPES.map((t, i) => [t, i]));
  const groups = listCoaGroups(records);
  const accounts = records.filter(isCoaAccount);
  const childrenOf = new Map<string, ManagerRecord[]>();
  const roots: ManagerRecord[] = [];

  for (const g of groups) {
    const parent = (g.parentGroup || "").trim().toLowerCase();
    if (!parent) {
      roots.push(g);
    } else {
      const list = childrenOf.get(parent) ?? [];
      list.push(g);
      childrenOf.set(parent, list);
    }
  }

  const sortGroups = (list: ManagerRecord[]) =>
    [...list].sort((a, b) => {
      const ta = typeOrder.get((a.type as (typeof COA_ROOT_TYPES)[number]) || "Asset") ?? 99;
      const tb = typeOrder.get((b.type as (typeof COA_ROOT_TYPES)[number]) || "Asset") ?? 99;
      if (ta !== tb) return ta - tb;
      return (a.name || "").localeCompare(b.name || "");
    });

  const accountsUnder = (groupName: string) =>
    accounts
      .filter((a) => (a.group || "").trim().toLowerCase() === groupName.trim().toLowerCase())
      .sort((a, b) => (a.code || "").localeCompare(b.code || "", undefined, { numeric: true }));

  const orphanAccounts = accounts
    .filter((a) => {
      const g = (a.group || "").trim().toLowerCase();
      return !g || !groups.some((gr) => coaGroupName(gr).toLowerCase() === g);
    })
    .sort((a, b) => (a.code || "").localeCompare(b.code || "", undefined, { numeric: true }));

  const out: ManagerRecord[] = [];
  const walk = (g: ManagerRecord) => {
    out.push(g);
    const name = coaGroupName(g);
    for (const acct of accountsUnder(name)) out.push(acct);
    for (const child of sortGroups(childrenOf.get(name.toLowerCase()) ?? [])) walk(child);
  };

  for (const g of sortGroups(roots)) walk(g);
  out.push(...orphanAccounts);

  // Include any group that was missed (orphan subgroup whose parent doesn't exist)
  for (const g of sortGroups(groups)) {
    if (!out.includes(g)) {
      out.push(g);
      out.push(...accountsUnder(coaGroupName(g)));
    }
  }

  return out;
}

export function coaDisplayDepth(records: ManagerRecord[], record: ManagerRecord): number {
  if (isCoaGroup(record)) {
    return coaGroupDepth(records, coaGroupName(record));
  }
  const g = (record.group || "").trim();
  if (!g) return 0;
  return coaGroupDepth(records, g) + 1;
}
