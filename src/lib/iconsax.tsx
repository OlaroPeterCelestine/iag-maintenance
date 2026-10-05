"use client";

import type { ModuleSlug } from "@/lib/module-data";
import type { Icon, IconProps } from "iconsax-react";
import {
  Flash,
  Speedometer,
  Activity,
  ArchiveBox,
  Bank,
  Book1,
  Box1,
  BoxTick,
  Briefcase,
  Building4,
  Calendar,
  CardCoin,
  Chart,
  ChartSquare,
  ClipboardText,
  ClipboardTick,
  Coffee,
  Cpu,
  Buildings2,
  Grid6,
  DocumentText,
  FolderOpen,
  Hierarchy2,
  LampCharge,
  MoneyRecive,
  MoneySend,
  People,
  PresentionChart,
  Profile2User,
  Receipt1,
  ReceiptItem,
  Repeat,
  Setting2,
  Setting3,
  Setting4,
  ShieldTick,
  Shop,
  StatusUp,
  Strongbox,
  TaskSquare,
  TimerPause,
  TruckFast,
  WalletMoney,
  Warning2,
} from "iconsax-react";

/**
 * iconsax-react sets defaults via defaultProps, which React 19 ignores.
 * Always supply color (and size) so strokes/fills actually render.
 */
export function SaxIcon({
  icon: Icon,
  size = 16,
  variant = "Linear",
  color = "currentColor",
  className,
  ...rest
}: IconProps & { icon: Icon }) {
  return (
    <Icon size={size} variant={variant} color={color} className={className} {...rest} />
  );
}

export const moduleIcons: Record<ModuleSlug, Icon> = {
  banking: Bank,
  "receipts-payments": WalletMoney,
  "expense-claims": Receipt1,
  requests: TaskSquare,
  "general-requests": TaskSquare,
  "oral-payment-requests": MoneySend,
  sales: Shop,
  purchases: TruckFast,
  inventory: Box1,
  projects: Briefcase,
  "contract-manager": Building4,
  fleet: TruckFast,
  security: ShieldTick,
  crm: Profile2User,
  logistics: TruckFast,
  distribution: Box1,
  rnd: Coffee,
  lab: ClipboardText,
  qa: ShieldTick,
  production: Setting2,
  benchmark: ChartSquare,
  pos: CardCoin,
  payroll: People,
  investments: Chart,
  assets: ArchiveBox,
  capital: Strongbox,
  accounts: Book1,
  documents: FolderOpen,
  reports: DocumentText,
};

export const SIDEBAR_ITEM_ICONS: Record<string, Icon> = {
  "Production Plans": Calendar,
  "Production Orders": TaskSquare,
  "Factories": Buildings2,
  "Shop Floors": Grid6,
  "Machines": Cpu,
  "Work Orders": TaskSquare,
  "Job Cards": ClipboardTick,
  "Preventive Schedules": Repeat,
  "PM Templates": Setting4,
  "Downtime": TimerPause,
  "Spare Parts": Setting3,
  "Reliability": Activity,
  "Machine Performance": Speedometer,
  "Energy": Flash,
  "Alerts": Warning2,
  "Recommendations": LampCharge,
  "Bill of Materials": Hierarchy2,
  "Batch Records": DocumentText,
  "Roast Batches": Coffee,
  "Packaging Runs": BoxTick,
  "Downtime Logs": TimerPause,
  "Yield Reports": Chart,
};

export function iconForNav(label: string): Icon {
  return SIDEBAR_ITEM_ICONS[label] ?? iconForLabel(label);
}

const labelIconRules: { match: RegExp; icon: Icon }[] = [
  { match: /balance sheet|trial balance|profit|loss|p&l|report/i, icon: PresentionChart },
  { match: /bank|cash account|reconcil/i, icon: Bank },
  { match: /receipt/i, icon: MoneyRecive },
  { match: /payment|payable/i, icon: MoneySend },
  { match: /transfer|wallet/i, icon: WalletMoney },
  { match: /expense|claim/i, icon: ReceiptItem },
  { match: /fleet|vehicle|driver|fuel request|fuel log|trip request|maintenance request|fleet cost|service reminder/i, icon: TruckFast },
  { match: /gate pass|visitor pass|security incident|^security$/i, icon: ShieldTick },
  { match: /lead|opportunity|complaint|^contact|crm|follow-up|follow up/i, icon: Profile2User },
  { match: /shipment|dispatch|route|proof of delivery|carrier|logistics/i, icon: TruckFast },
  { match: /distribution|picking|packing|delivery run|stock allocation/i, icon: Box1 },
  { match: /experiment|formulation|sensory|spec sheet|pilot batch|cost model|ai insight|r&d|rnd/i, icon: Coffee },
  { match: /product simulation|lab request|lab sample|lab trial|lab method|lab result|instrument calibration|stability study/i, icon: ClipboardText },
  { match: /quality check|incoming inspection|in-process check|release decision|non-conformance|capa|hold & release|quality assurance|^qa$/i, icon: ShieldTick },
  { match: /production plan|work center|machine|bill of materials|batch record|downtime log|yield report/i, icon: Setting2 },
  { match: /work system|benchmark study|kpi definition|cycle time|productivity score|gap analys|improvement action/i, icon: ChartSquare },
  { match: /^department/i, icon: Building4 },
  { match: /project manager/i, icon: Briefcase },
  { match: /contract manager/i, icon: Building4 },
  { match: /pos terminal|^pos |register|till|cash session|point of sale|daily closing/i, icon: CardCoin },
  { match: /hr desk|leave|attendance|holiday|onboarding|job position/i, icon: People },
  { match: /contractor invoice/i, icon: DocumentText },
  { match: /contractor|customer|people|employee|payroll|user/i, icon: Profile2User },
  { match: /sales|invoice|quote|order/i, icon: Shop },
  { match: /purchase|supplier|vendor/i, icon: TruckFast },
  { match: /inventory|stock|item|product/i, icon: Box1 },
  { match: /gantt|fleet cost/i, icon: ChartSquare },
  { match: /requirement/i, icon: ClipboardText },
  { match: /oral payment/i, icon: MoneySend },
  { match: /general request|^requests$/i, icon: TaskSquare },
  { match: /requisition|payment request|progress certificate|milestone|phase|project|task|time entr/i, icon: TaskSquare },
  { match: /invest|chart|performance/i, icon: ChartSquare },
  { match: /asset|capital|equity/i, icon: Strongbox },
  { match: /account|journal|ledger/i, icon: Book1 },
  { match: /document|file|attach/i, icon: FolderOpen },
  { match: /tax|vat|gst/i, icon: Receipt1 },
  { match: /currenc|fx|money/i, icon: CardCoin },
  { match: /date|number|calendar/i, icon: Calendar },
  { match: /form|footer|default|field/i, icon: ClipboardText },
  { match: /business|detail|company/i, icon: Building4 },
  { match: /setting|customiz|tab/i, icon: Setting2 },
  { match: /division|status/i, icon: StatusUp },
  { match: /email|theme/i, icon: DocumentText },
];

export function iconForLabel(label: string): Icon {
  const exact = SIDEBAR_ITEM_ICONS[label];
  if (exact) return exact;
  for (const rule of labelIconRules) {
    if (rule.match.test(label)) return rule.icon;
  }
  return DocumentText;
}
