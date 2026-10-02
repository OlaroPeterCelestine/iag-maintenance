"use client";

import { canAccessSpecialNav } from "@/lib/access-control";
import { AUTH_CHANGED_EVENT } from "@/lib/auth";
import { Setting2 } from "iconsax-react";
import Link from "next/link";
import { useEffect, useState } from "react";

/** Header settings control — hidden when the role cannot open Settings. */
export function PageMoreMenu() {
  const [canSettings, setCanSettings] = useState(false);

  useEffect(() => {
    const sync = () => setCanSettings(canAccessSpecialNav("settings"));
    sync();
    window.addEventListener(AUTH_CHANGED_EVENT, sync);
    window.addEventListener("financeiag-settings-changed", sync);
    return () => {
      window.removeEventListener(AUTH_CHANGED_EVENT, sync);
      window.removeEventListener("financeiag-settings-changed", sync);
    };
  }, []);

  if (!canSettings) return null;

  return (
    <Link
      href="/settings"
      className="inline-flex size-7 items-center justify-center rounded-lg text-slate-500 hover:bg-muted hover:text-foreground"
      aria-label="Settings"
      title="Settings"
    >
      <Setting2 size={16} variant="Linear" color="currentColor" />
    </Link>
  );
}
