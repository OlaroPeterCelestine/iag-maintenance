"use client";

import { useAppShell } from "@/components/app-shell";
import { NotificationsMenu } from "@/components/notifications-menu";
import { PageMoreMenu } from "@/components/page-more-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ChevronDown,
  Coffee,
  FlaskConical,
  Menu,
  MessageCircleQuestion,
  PackageCheck,
  Search,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { defaultHomePath } from "@/lib/access-control";

const QUESTIONS = [
  {
    category: "Product development",
    question: "What must be in a product brief before lab work starts?",
    answer:
      "Name the target customer, problem, product format, target price and margin, sales channel, constraints, deadline, owner, and one measurable definition of success. Keep it to one page.",
  },
  {
    category: "Product development",
    question: "How can we test ideas faster without creating unreliable results?",
    answer:
      "Use a control, change one important variable at a time, predefine pass/fail criteria, run the smallest representative batch, and record every input and process setting. Speed comes from removing unclear tests, not from removing records.",
  },
  {
    category: "Product development",
    question: "When is a product ready to move from the lab to a pilot?",
    answer:
      "Move only when the recipe is repeatable, sensory and technical limits are defined, critical ingredients are available, the expected unit cost is acceptable, and the pilot has a specific scale-up question to answer.",
  },
  {
    category: "Coffee",
    question: "What should be recorded when green coffee arrives?",
    answer:
      "Record supplier, farm or origin, variety, process, crop year, lot, bag count, net weight, moisture, grade, sample score, certificates, storage location, and acceptance or quarantine status.",
  },
  {
    category: "Coffee",
    question: "What makes a roast batch traceable?",
    answer:
      "Link the roast batch to the green lot and production order, then record recipe/profile, roaster, operator, date and time, charge and end temperatures, duration, input weight, output weight, roast loss, and quality disposition.",
  },
  {
    category: "Coffee",
    question: "How is roast loss calculated?",
    answer:
      "Roast loss % = (green input weight − roasted output weight) ÷ green input weight × 100. Investigate results outside the approved profile range because they affect flavour, yield, and cost.",
  },
  {
    category: "Quality",
    question: "What should block a coffee batch from packaging?",
    answer:
      "A batch stays on quality hold if traceability is incomplete, the roast profile is outside tolerance, cupping or physical tests fail, foreign material or contamination is suspected, or release has not been signed by the responsible person.",
  },
  {
    category: "Quality",
    question: "What is the difference between a quality check and a release?",
    answer:
      "A quality check records observations and test results. A release is the authorized decision that the batch meets its specification and may enter the next stage. Keep the tester and release owner visible.",
  },
  {
    category: "Packaging",
    question: "What must be checked before a packaging run begins?",
    answer:
      "Confirm the released roast batch, correct SKU and pack size, clean and cleared line, approved bag and label versions, calibrated scales, lot-code and best-before setup, packaging-material lots, and planned quantity.",
  },
  {
    category: "Packaging",
    question: "How should a packaging run be reconciled?",
    answer:
      "Reconcile roasted coffee issued against good packs, samples, rework, spillage, and waste. Also reconcile packaging materials issued, used, damaged, and returned. Explain material variances before closing the run.",
  },
  {
    category: "Costing",
    question: "What belongs in the true cost of a coffee product?",
    answer:
      "Include landed green-coffee cost, roasting loss, direct labour, energy, quality and sample loss, packaging, labels, production overhead, freight where applicable, and expected waste. Divide by saleable output, not planned output.",
  },
  {
    category: "Costing",
    question: "Why link production records to Inventory?",
    answer:
      "The links provide lot traceability and allow component consumption, finished-goods receipt, waste, stock value, and cost of sales to agree. They also make recalls and margin analysis much faster.",
  },
] as const;

const CATEGORY_ICONS = {
  "Product development": FlaskConical,
  Coffee,
  Quality: ShieldCheck,
  Packaging: PackageCheck,
  Costing: Coffee,
} as const;

export default function QaPage() {
  const { openSidebar } = useAppShell();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const categories = ["All", ...new Set(QUESTIONS.map((item) => item.category))];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return QUESTIONS.filter((item) => {
      const matchesCategory = category === "All" || item.category === category;
      const matchesQuery =
        !q || `${item.question} ${item.answer} ${item.category}`.toLowerCase().includes(q);
      return matchesCategory && matchesQuery;
    });
  }, [category, query]);

  return (
    <>
      <header className="flex h-11 items-center justify-between border-b border-slate-200/80 bg-white px-3 sm:px-4">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            className="lg:hidden"
            onClick={openSidebar}
            aria-label="Open navigation"
          >
            <Menu size={18} />
          </Button>
          <div className="flex items-center gap-2 text-[13px] text-slate-400">
            <MessageCircleQuestion size={14} />
            <Link href={defaultHomePath()} className="hover:text-slate-700">Overview</Link>
            <span>/</span>
            <span className="font-medium text-slate-700">Q&amp;A</span>
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          <NotificationsMenu />
          <ThemeToggle />
          <PageMoreMenu />
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-5 p-4 sm:p-5">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-[11px] font-semibold tracking-wide text-orange-600 uppercase">
                Product development knowledge
              </p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">
                Questions &amp; answers
              </h1>
              <p className="mt-1.5 max-w-2xl text-[13px] text-slate-500">
                Quick answers for lab trials, coffee production, quality release,
                packaging, traceability, and product costing.
              </p>
            </div>
            <Link
              href="/lab"
              className="inline-flex h-9 shrink-0 items-center justify-center rounded-md bg-slate-950 px-4 text-[12px] font-medium text-white hover:bg-slate-800"
            >
              Open Lab
            </Link>
          </div>
          <div className="relative mt-5">
            <Search size={15} className="absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Ask about recipes, roasting, QC, packaging or costing…"
              className="h-10 border-slate-200 bg-slate-50 pl-9 text-[13px] shadow-none"
            />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {categories.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setCategory(item)}
                className={`rounded-full border px-3 py-1.5 text-[11px] font-medium transition-colors ${
                  category === item
                    ? "border-orange-500 bg-orange-500 text-white"
                    : "border-slate-200 bg-white text-slate-600 hover:border-orange-200 hover:bg-orange-50"
                }`}
              >
                {item}
              </button>
            ))}
          </div>
        </section>

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/80 px-4 py-3">
            <p className="text-[12px] font-semibold text-slate-800">
              {filtered.length} answer{filtered.length === 1 ? "" : "s"}
            </p>
            <p className="text-[11px] text-slate-400">Open a question to read the answer</p>
          </div>
          {filtered.length ? (
            <div className="divide-y divide-slate-100">
              {filtered.map((item, index) => {
                const CategoryIcon = CATEGORY_ICONS[item.category];
                return (
                  <details key={item.question} className="group px-4 py-1">
                    <summary className="flex cursor-pointer list-none items-start gap-3 py-3 text-left">
                      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-orange-50 text-orange-600">
                        <CategoryIcon size={14} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-semibold text-slate-900">
                          {item.question}
                        </span>
                        <span className="mt-0.5 block text-[11px] text-slate-400">
                          {item.category} · Q{String(index + 1).padStart(2, "0")}
                        </span>
                      </span>
                      <ChevronDown
                        size={16}
                        className="mt-1 shrink-0 text-slate-400 transition-transform group-open:rotate-180"
                      />
                    </summary>
                    <div className="mr-2 mb-4 ml-10 rounded-lg border border-slate-100 bg-slate-50 px-4 py-3 text-[13px] leading-relaxed text-slate-600">
                      {item.answer}
                    </div>
                  </details>
                );
              })}
            </div>
          ) : (
            <div className="px-4 py-14 text-center">
              <MessageCircleQuestion size={28} className="mx-auto text-slate-300" />
              <p className="mt-3 text-[13px] font-medium text-slate-700">No matching answer yet.</p>
              <p className="mt-1 text-[12px] text-slate-500">
                Try a shorter question or select another category.
              </p>
            </div>
          )}
        </section>
      </main>
    </>
  );
}
