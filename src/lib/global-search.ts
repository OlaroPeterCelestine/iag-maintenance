import { entityKey, type ManagerRecord } from "@/lib/manager-entities";
import {
  hrefForStoredEntity,
  NAV_MODULES,
  routeSlugForStoredEntity,
  type ModuleSlug,
} from "@/lib/module-data";
import { listMemoryRecordKeys, getMemoryRecords } from "@/lib/db/client-store";
import { currentApprovalDesk } from "@/lib/approval-desk";
import { canAccessPath, defaultHomePath } from "@/lib/access-control";

export type SearchHit = {
  id: string;
  group: "Pages" | "Modules" | "Records";
  title: string;
  subtitle?: string;
  href: string;
  keywords: string;
};

function recordLabel(record: ManagerRecord) {
  return (
    record.reference ||
    record.name ||
    record.party ||
    record.customer ||
    record.supplier ||
    record.code ||
    record.description ||
    record.id.slice(0, 8).toUpperCase()
  );
}

function recordHaystack(record: ManagerRecord) {
  return [
    record.reference,
    record.name,
    record.code,
    record.party,
    record.customer,
    record.supplier,
    record.email,
    record.description,
    record.account,
    record.narration,
    record.status,
    record.amount,
    record.total,
    record.paidBy,
    record.payee,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function loadStoredRecordBuckets(): { module: string; entity: string; records: ManagerRecord[] }[] {
  if (typeof window === "undefined") return [];
  return listMemoryRecordKeys().map(({ module, entity }) => ({
    module,
    entity,
    records: getMemoryRecords(module, entity),
  }));
}

function entityTitle(entity: string) {
  return entity
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function buildSearchIndex(enabledTabs?: ModuleSlug[]): SearchHit[] {
  const allowed = enabledTabs ? new Set(enabledTabs) : null;
  const desk = typeof window !== "undefined" ? currentApprovalDesk() : null;
  const homeHref = typeof window !== "undefined" ? defaultHomePath() : "/";
  const isContractorHome = homeHref === "/contractor" || homeHref.startsWith("/contractor/");
  const hits: SearchHit[] = [
    {
      id: "page-overview",
      group: "Pages",
      title: isContractorHome ? "Home" : "Overview",
      subtitle: isContractorHome ? "Contractor portal" : "Dashboard",
      href: homeHref,
      keywords: "overview dashboard home summary contractor portal",
    },
    {
      id: "page-guides",
      group: "Pages",
      title: "Guides",
      subtitle: "Help & documentation",
      href: "/guides",
      keywords: "guides help docs documentation",
    },
    {
      id: "page-templates",
      group: "Pages",
      title: "Document templates",
      subtitle: "Invoice & quote layouts",
      href: "/templates",
      keywords:
        "templates document template invoice layout pro forma print pdf theme terms bank details",
    },
    {
      id: "page-accounting-documents",
      group: "Pages",
      title: "Accounting documents",
      subtitle: "Required source documents pack",
      href: "/accounting-documents",
      keywords:
        "accounting documents required invoice receipt payment journal payslip withholding tax vat payroll",
    },
    {
      id: "page-payment-requests",
      group: "Pages",
      title: desk?.navLabel || "Approval desk",
      subtitle: desk?.subtitle || "Role-scoped payment approval queue",
      href: "/payment-requests",
      keywords:
        "payment requests monitor approve department project fleet finance payee overdue awaiting ceo gm dept head approvals red urgent documents desk",
    },
    {
      id: "page-settings",
      group: "Pages",
      title: "Settings",
      subtitle: "Business, currency, tabs",
      href: "/settings",
      keywords: "settings preferences business currency",
    },
    {
      id: "page-profile",
      group: "Pages",
      title: "Profile",
      subtitle: "Account",
      href: "/profile",
      keywords: "profile account user",
    },
  ];

  for (const mod of NAV_MODULES) {
    if (allowed && !allowed.has(mod.slug)) continue;
    hits.push({
      id: `module-${mod.slug}`,
      group: "Modules",
      title: mod.label,
      subtitle: "Module",
      href: mod.href,
      keywords: `${mod.label} ${mod.slug}`.toLowerCase(),
    });
    for (const item of mod.items) {
      const key = entityKey(item);
      hits.push({
        id: `entity-${mod.slug}-${key}`,
        group: "Modules",
        title: item,
        subtitle: mod.label,
        href: `${mod.href}?view=${key}`,
        keywords: `${item} ${mod.label} ${key}`.toLowerCase(),
      });
    }
  }

  for (const bucket of loadStoredRecordBuckets()) {
    const routeSlug = routeSlugForStoredEntity(bucket.module, bucket.entity);
    if (allowed && !allowed.has(routeSlug as ModuleSlug)) continue;
    const mod = NAV_MODULES.find((m) => m.slug === routeSlug);
    const label = entityTitle(bucket.entity);
    for (const record of bucket.records) {
      const title = recordLabel(record);
      const party = record.party || record.customer || record.supplier || record.name || "";
      hits.push({
        id: `record-${bucket.module}-${bucket.entity}-${record.id}`,
        group: "Records",
        title,
        subtitle: [mod?.label ?? routeSlug, label, party, record.status]
          .filter((part, i, arr) => part && arr.indexOf(part) === i)
          .join(" · "),
        href: hrefForStoredEntity(bucket.module, bucket.entity),
        keywords: `${recordHaystack(record)} ${label} ${routeSlug}`,
      });
    }
  }

  // Search must never surface a page or record the role cannot open.
  if (typeof window === "undefined") return hits;
  return hits.filter((hit) => canAccessPath(hit.href));
}

export function filterSearchHits(hits: SearchHit[], query: string, limit = 40): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return hits.filter((h) => h.group !== "Records").slice(0, limit);
  }
  const scored = hits
    .map((hit) => {
      const title = hit.title.toLowerCase();
      const sub = (hit.subtitle || "").toLowerCase();
      const keys = hit.keywords.toLowerCase();
      let score = 0;
      if (title === q) score += 100;
      else if (title.startsWith(q)) score += 80;
      else if (title.includes(q)) score += 50;
      if (sub.includes(q)) score += 20;
      if (keys.includes(q)) score += 10;
      const parts = q.split(/\s+/).filter(Boolean);
      if (parts.length > 1 && parts.every((p) => keys.includes(p) || title.includes(p))) score += 15;
      return { hit, score };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.hit.title.localeCompare(b.hit.title));
  return scored.slice(0, limit).map((row) => row.hit);
}
