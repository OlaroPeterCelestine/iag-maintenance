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
    <header className="flex h-10 shrink-0 items-center justify-between border-b border-slate-200/70 bg-white/95 px-2.5 backdrop-blur-sm sm:px-3">
      <div className="flex min-w-0 items-center gap-1.5">
        <Button
          variant="ghost"
          size="icon-sm"
          className="lg:hidden"
          onClick={openSidebar}
          aria-label="Open navigation"
        >
          <Menu size={17} />
        </Button>
        <div className="flex min-w-0 items-center gap-1.5 text-[12.5px] leading-none text-slate-400">
          {icon}
          {children}
        </div>
      </div>
      <div className="flex items-center gap-0">
        <NotificationsMenu />
        <ThemeToggle />
        <PageMoreMenu />
      </div>
    </header>
  );
}
