"use client";

import { useAppShell } from "@/components/app-shell";
import { NotificationsMenu } from "@/components/notifications-menu";
import { PageMoreMenu } from "@/components/page-more-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  GUIDE_CHAPTERS,
  GUIDE_FEATURE_COUNT,
  findArticle,
  getAllGuideFeatures,
  type GuideArticle,
  type GuideFeatureLine,
} from "@/lib/guides-data";
import { canAccessSpecialNav, defaultHomePath } from "@/lib/access-control";
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  FileText,
  LayoutGrid,
  List,
  Menu,
  Search,
} from "lucide-react";
import Link from "next/link";
import { PageFormGuide } from "@/components/page-form-guide";
import { useMemo, useState } from "react";

type ViewMode = "all" | "chapters" | "pages";

export default function GuidesPage() {
  const { openSidebar } = useAppShell();
  const [query, setQuery] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("pages");
  const [requiredOnly, setRequiredOnly] = useState(false);
  const [chapterId, setChapterId] = useState<string | null>(null);
  const [articleId, setArticleId] = useState<string | null>(null);

  const allFeatures = useMemo(() => getAllGuideFeatures(), []);

  const found = articleId ? findArticle(articleId) : null;
  const chapter = chapterId
    ? (GUIDE_CHAPTERS.find((c) => c.id === chapterId) ?? null)
    : (found?.chapter ?? null);

  const searchHits = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return allFeatures.filter((line) => {
      const hay = [
        line.article.title,
        line.article.summary,
        line.sectionTitle,
        line.chapterTitle,
        ...(line.article.steps ?? []),
        ...(line.article.notes ?? []),
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [query, allFeatures]);

  function openArticle(id: string) {
    const hit = findArticle(id);
    if (!hit) return;
    setChapterId(hit.chapter.id);
    setArticleId(id);
    setQuery("");
  }

  function goHome() {
    setArticleId(null);
    setChapterId(null);
  }

  const showingHome = !chapter && !found;

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
            <BookOpen size={14} />
            <Link href={defaultHomePath()} className="hover:text-slate-700">
              Overview
            </Link>
            <span>/</span>
            {found ? (
              <>
                <button type="button" className="hover:text-slate-700" onClick={goHome}>
                  Guides
                </button>
                <span>/</span>
                <button
                  type="button"
                  className="hover:text-slate-700"
                  onClick={() => setArticleId(null)}
                >
                  {found.chapter.title}
                </button>
                <span>/</span>
                <span className="font-medium text-slate-700">{found.article.title}</span>
              </>
            ) : chapter ? (
              <>
                <button type="button" className="hover:text-slate-700" onClick={goHome}>
                  Guides
                </button>
                <span>/</span>
                <span className="font-medium text-slate-700">{chapter.title}</span>
              </>
            ) : (
              <span className="font-medium text-slate-700">Guides</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          <NotificationsMenu />
          <ThemeToggle />
          <PageMoreMenu />
        </div>
      </header>

      <div className="flex w-full flex-1 flex-col gap-4 p-4 sm:p-5">
        {showingHome ? (
          <>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h1 className="text-[22px] font-semibold tracking-tight text-slate-900">
                  FinaceManagerIAG Guides
                </h1>
                <p className="mt-1 max-w-2xl text-[13px] text-slate-500">
                  What every page is for, and the input fields on each form — including the data
                  required before a record can be saved. Feature steps ({GUIDE_FEATURE_COUNT}) are
                  under All features.
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex rounded-lg border border-slate-200 bg-white p-0.5">
                    <button
                      type="button"
                      onClick={() => setViewMode("pages")}
                      className={`inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium ${
                        viewMode === "pages"
                          ? "bg-slate-900 text-white"
                          : "text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      <BookOpen size={14} />
                      Pages & forms
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode("all")}
                      className={`inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium ${
                        viewMode === "all"
                          ? "bg-slate-900 text-white"
                          : "text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      <List size={14} />
                      All features
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode("chapters")}
                      className={`inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium ${
                        viewMode === "chapters"
                          ? "bg-slate-900 text-white"
                          : "text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      <LayoutGrid size={14} />
                      Chapters
                    </button>
                  </div>
                  {viewMode === "pages" ? (
                    <button
                      type="button"
                      onClick={() => setRequiredOnly((value) => !value)}
                      className={`inline-flex h-8 items-center rounded-md border px-2.5 text-[12px] font-medium ${
                        requiredOnly
                          ? "border-orange-200 bg-orange-50 text-orange-800"
                          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      Required fields only
                    </button>
                  ) : null}
                </div>
                <div className="relative w-full sm:w-72">
                  <Search
                    size={14}
                    className="absolute top-1/2 left-3 -translate-y-1/2 text-slate-400"
                  />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={
                      viewMode === "pages"
                        ? "Search pages, forms, or fields…"
                        : "Search all features…"
                    }
                    className="h-9 border-slate-200 bg-white pl-9 text-[13px] shadow-none"
                  />
                </div>
              </div>
            </div>

            {viewMode === "pages" ? (
              <PageFormGuide query={query} requiredOnly={requiredOnly} />
            ) : query.trim() ? (
              <FeatureList
                lines={searchHits}
                emptyLabel="No matching features."
                onOpen={openArticle}
                showChapter
              />
            ) : viewMode === "chapters" ? (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {GUIDE_CHAPTERS.map((ch) => {
                  const count = ch.sections.reduce((n, s) => n + s.articles.length, 0);
                  return (
                    <button
                      key={ch.id}
                      type="button"
                      onClick={() => setChapterId(ch.id)}
                      className="rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition-colors hover:border-orange-200 hover:bg-orange-50/40"
                    >
                      <p className="text-[11px] font-medium tracking-wide text-orange-600 uppercase">
                        Chapter {ch.number}
                      </p>
                      <p className="mt-1 text-[15px] font-semibold text-slate-900">{ch.title}</p>
                      <p className="mt-2 text-[12px] leading-relaxed text-slate-500">{ch.intro}</p>
                      <p className="mt-3 text-[11px] text-slate-400">{count} features</p>
                    </button>
                  );
                })}
              </div>
            ) : (
              <AllFeaturesLineByLine lines={allFeatures} onOpen={openArticle} />
            )}
          </>
        ) : found ? (
          <ArticleView
            article={found.article}
            chapterLabel={`${found.chapter.number}. ${found.chapter.title}`}
            sectionLabel={found.section.title}
            onBack={() => setArticleId(null)}
          />
        ) : chapter ? (
          <div className="space-y-4">
            <Button
              variant="ghost"
              size="sm"
              className="-ml-2 text-slate-600"
              onClick={goHome}
            >
              <ArrowLeft size={14} /> All features
            </Button>
            <div>
              <p className="text-[11px] font-medium tracking-wide text-orange-600 uppercase">
                Chapter {chapter.number}
              </p>
              <h1 className="text-[22px] font-semibold tracking-tight text-slate-900">
                {chapter.title}
              </h1>
              <p className="mt-1 max-w-2xl text-[13px] text-slate-500">{chapter.intro}</p>
            </div>
            {chapter.sections.map((sec) => (
              <div
                key={sec.id}
                className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
              >
                <div className="border-b border-slate-100 bg-slate-50/80 px-4 py-2.5">
                  <h2 className="text-[13px] font-semibold text-slate-800">{sec.title}</h2>
                </div>
                <ul className="divide-y divide-slate-100">
                  {sec.articles.map((article, i) => (
                    <li key={article.id}>
                      <button
                        type="button"
                        onClick={() => setArticleId(article.id)}
                        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50"
                      >
                        <span className="w-8 shrink-0 text-[11px] font-medium text-slate-400 tabular-nums">
                          {i + 1}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] font-medium text-slate-900">
                            {article.title}
                          </span>
                          <span className="mt-0.5 line-clamp-1 block text-[12px] text-slate-500">
                            {article.summary}
                          </span>
                        </span>
                        <ChevronRight size={16} className="shrink-0 text-slate-300" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </>
  );
}

function AllFeaturesLineByLine({
  lines,
  onOpen,
}: {
  lines: GuideFeatureLine[];
  onOpen: (id: string) => void;
}) {
  // Decide the chapter/section headings up front. Tracking "last seen" inside
  // the map mutated a variable while rendering, so the same list could paint
  // differently depending on how often React re-ran the map.
  const rows = lines.map((line, index) => {
    const previous = index > 0 ? lines[index - 1] : undefined;
    return {
      line,
      showChapter: line.chapterId !== previous?.chapterId,
      showSection: line.sectionId !== previous?.sectionId,
    };
  });

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/80 px-4 py-2.5">
        <p className="text-[12px] font-semibold text-slate-800">
          All features · {lines.length} line by line
        </p>
        <p className="text-[11px] text-slate-400">Scroll or search</p>
      </div>
      <ul className="divide-y divide-slate-100">
        {rows.map(({ line, showChapter, showSection }) => {
          return (
            <li key={line.article.id}>
              {showChapter ? (
                <div className="border-b border-orange-100 bg-orange-50/90 px-4 py-2">
                  <p className="text-[11px] font-semibold tracking-wide text-orange-700 uppercase">
                    Chapter {line.chapterNumber} · {line.chapterTitle}
                  </p>
                </div>
              ) : null}
              {showSection ? (
                <div className="bg-slate-50/90 px-4 py-1.5">
                  <p className="text-[11px] font-medium text-slate-500">{line.sectionTitle}</p>
                </div>
              ) : null}
              <button
                type="button"
                onClick={() => onOpen(line.article.id)}
                className="flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-slate-50"
              >
                <span className="mt-0.5 w-9 shrink-0 text-[11px] font-medium text-slate-400 tabular-nums">
                  {String(line.index).padStart(3, "0")}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium text-slate-900">
                    {line.article.title}
                  </span>
                  <span className="mt-0.5 line-clamp-1 block text-[12px] text-slate-500">
                    {line.article.summary}
                  </span>
                </span>
                <ChevronRight size={16} className="mt-1 shrink-0 text-slate-300" />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function FeatureList({
  lines,
  emptyLabel,
  onOpen,
  showChapter,
}: {
  lines: GuideFeatureLine[];
  emptyLabel: string;
  onOpen: (id: string) => void;
  showChapter?: boolean;
}) {
  if (lines.length === 0) {
    return (
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <p className="px-4 py-12 text-center text-[13px] text-slate-500">{emptyLabel}</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 bg-slate-50/80 px-4 py-2.5">
        <p className="text-[12px] font-semibold text-slate-800">
          {lines.length} matching feature{lines.length === 1 ? "" : "s"}
        </p>
      </div>
      <ul className="divide-y divide-slate-100">
        {lines.map((line) => (
          <li key={line.article.id}>
            <button
              type="button"
              onClick={() => onOpen(line.article.id)}
              className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-50"
            >
              <span className="mt-0.5 w-9 shrink-0 text-[11px] font-medium text-slate-400 tabular-nums">
                {String(line.index).padStart(3, "0")}
              </span>
              <FileText size={16} className="mt-0.5 shrink-0 text-orange-500" />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium text-slate-900">
                  {line.article.title}
                </span>
                {showChapter ? (
                  <span className="mt-0.5 block text-[11px] text-slate-400">
                    Ch. {line.chapterNumber} · {line.sectionTitle}
                  </span>
                ) : null}
                <span className="mt-1 line-clamp-2 block text-[12px] text-slate-500">
                  {line.article.summary}
                </span>
              </span>
              <ChevronRight size={16} className="mt-1 shrink-0 text-slate-300" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ArticleView({
  article,
  chapterLabel,
  sectionLabel,
  onBack,
}: {
  article: GuideArticle;
  chapterLabel: string;
  sectionLabel: string;
  onBack: () => void;
}) {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <Button variant="ghost" size="sm" className="-ml-2 text-slate-600" onClick={onBack}>
        <ArrowLeft size={14} /> Back
      </Button>
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <p className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">
          {chapterLabel}
        </p>
        <p className="mt-1 text-[12px] text-slate-500">{sectionLabel}</p>
        <h1 className="mt-2 text-[22px] font-semibold tracking-tight text-slate-900">
          {article.title}
        </h1>
        <p className="mt-3 text-[14px] leading-relaxed text-slate-600">{article.summary}</p>

        {article.steps && article.steps.length > 0 && (
          <div className="mt-6">
            <h2 className="text-[13px] font-semibold text-slate-900">Steps</h2>
            <ol className="mt-3 space-y-2">
              {article.steps.map((step, i) => (
                <li
                  key={`${i}-${step}`}
                  className="flex gap-3 rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2.5 text-[13px] text-slate-700"
                >
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-orange-500 text-[11px] font-semibold text-white">
                    {i + 1}
                  </span>
                  <span className="pt-0.5">{step}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {article.notes && article.notes.length > 0 && (
          <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50/80 p-4">
            <p className="text-[12px] font-semibold text-amber-900">Notes</p>
            <ul className="mt-2 space-y-1.5">
              {article.notes.map((note) => (
                <li key={note} className="flex gap-2 text-[12px] text-amber-900/90">
                  <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-amber-600" />
                  {note}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-6 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
          {canAccessSpecialNav("settings") ? (
            <Link
              href="/settings"
              className="inline-flex h-9 items-center justify-center rounded-md bg-black px-4 text-[13px] font-medium text-white hover:bg-zinc-800"
            >
              Open Settings
            </Link>
          ) : null}
          <Link
            href={defaultHomePath()}
            className="inline-flex h-9 items-center justify-center rounded-md border border-slate-200 bg-white px-4 text-[13px] font-medium text-slate-700 hover:bg-slate-50"
          >
            Overview
          </Link>
        </div>
      </div>
    </div>
  );
}
