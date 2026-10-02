"use client";

import { useAppShell } from "@/components/app-shell";
import { NotificationsMenu } from "@/components/notifications-menu";
import { PageMoreMenu } from "@/components/page-more-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { defaultHomePath } from "@/lib/access-control";
import { latestRelease, RELEASE_NOTES } from "@/lib/release-notes";
import { ExternalLink, Menu, Search, StickyNote } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

export default function ReleaseNotesPage() {
  const { openSidebar } = useAppShell();
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return RELEASE_NOTES;
    return RELEASE_NOTES.filter((note) => {
      const hay = [
        note.version,
        note.title,
        note.summary,
        note.date,
        ...note.highlights,
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [query]);

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
            <StickyNote size={14} />
            <Link href={defaultHomePath()} className="hover:text-slate-700">
              Overview
            </Link>
            <span>/</span>
            <span className="font-medium text-slate-700">Release notes</span>
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
          <div>
            <p className="text-[11px] font-semibold tracking-wide text-orange-600 uppercase">
              Product updates
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">
              Release notes
            </h1>
            <p className="mt-1.5 max-w-2xl text-[13px] text-slate-500">
              Current build is {latestRelease().version}. What shipped in each tagged
              release of this app, newest first.
            </p>
          </div>
          <div className="relative mt-5">
            <Search
              size={15}
              className="absolute top-1/2 left-3 -translate-y-1/2 text-slate-400"
            />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search versions, features, fixes…"
              className="h-10 border-slate-200 bg-slate-50 pl-9 text-[13px] shadow-none"
            />
          </div>
        </section>

        <div className="flex flex-col gap-3">
          {filtered.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-8 text-center text-[13px] text-slate-500">
              No releases match “{query.trim()}”.
            </p>
          ) : (
            filtered.map((note, index) => (
              <article
                key={note.version}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-md bg-slate-950 px-2 py-0.5 text-[12px] font-semibold text-white">
                        {note.version}
                      </span>
                      {index === 0 ? (
                        <span className="rounded-md bg-orange-50 px-2 py-0.5 text-[11px] font-medium text-orange-700">
                          Latest
                        </span>
                      ) : null}
                      <span className="text-[12px] text-slate-400">{note.date}</span>
                    </div>
                    <h2 className="mt-2 text-[17px] font-semibold tracking-tight text-slate-950">
                      {note.title}
                    </h2>
                    <p className="mt-1 max-w-2xl text-[13px] text-slate-500">
                      {note.summary}
                    </p>
                  </div>
                  {note.githubUrl ? (
                    <a
                      href={note.githubUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 px-3 text-[12px] font-medium text-slate-600 hover:bg-slate-50"
                    >
                      GitHub
                      <ExternalLink size={12} />
                    </a>
                  ) : null}
                </div>
                <ul className="mt-4 space-y-1.5 border-t border-slate-100 pt-4">
                  {note.highlights.map((item) => (
                    <li
                      key={item}
                      className="flex gap-2 text-[13px] text-slate-700"
                    >
                      <span className="mt-2 size-1 shrink-0 rounded-full bg-orange-500" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </article>
            ))
          )}
        </div>
      </main>
    </>
  );
}
