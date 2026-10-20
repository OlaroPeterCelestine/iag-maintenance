"use client";

import { useAppShell } from "@/components/app-shell";
import { NotificationsMenu } from "@/components/notifications-menu";
import { PageMoreMenu } from "@/components/page-more-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Menu } from "lucide-react";
import type { ReactNode } from "react";

/** Shared page header: mobile menu, breadcrumb, and the account controls. */
export function PageToolbar({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  const { openSidebar } = useAppShell();
  return (
    <header className="flex h-11 shrink-0 items-center justify-between border-b border-slate-200/80 bg-white px-3 sm:px-4">
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
        <div className="flex min-w-0 items-center gap-2 text-[13px] text-slate-400">{icon}{children}</div>
      </div>
      <div className="flex items-center gap-0.5">
        <NotificationsMenu />
        <ThemeToggle />
        <PageMoreMenu />
      </div>
    </header>
  );
}
