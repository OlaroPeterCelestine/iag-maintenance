"use client";

import { Button } from "@/components/ui/button";
import {
  applyThemeMode,
  loadThemeMode,
  resolveDark,
  saveThemeMode,
  systemPrefersDark,
  THEME_CHANGED_EVENT,
  type ThemeMode,
} from "@/lib/theme";
import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

/** Small hook shared by the header toggle and the settings control. */
export function useThemeMode() {
  const [mode, setMode] = useState<ThemeMode>("light");

  useEffect(() => {
    setMode(loadThemeMode());
    const onChange = () => setMode(loadThemeMode());
    window.addEventListener(THEME_CHANGED_EVENT, onChange);
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const onMedia = () => {
      if (loadThemeMode() === "system") applyThemeMode("system");
    };
    media?.addEventListener?.("change", onMedia);
    return () => {
      window.removeEventListener(THEME_CHANGED_EVENT, onChange);
      media?.removeEventListener?.("change", onMedia);
    };
  }, []);

  const setTheme = (next: ThemeMode) => {
    setMode(next);
    saveThemeMode(next);
  };

  return { mode, setTheme };
}

/** Header button: click to flip between light and dark. */
export function ThemeToggle() {
  const { mode, setTheme } = useThemeMode();
  const isDark = resolveDark(mode);

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={isDark ? "Light mode" : "Dark mode"}
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      {isDark ? <Sun size={16} /> : <Moon size={16} />}
    </Button>
  );
}

/** Settings control: choose Light, Dark, or System. */
export function ThemeModeChooser() {
  const { mode, setTheme } = useThemeMode();
  const options: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
    { value: "light", label: "Light", icon: Sun },
    { value: "dark", label: "Dark", icon: Moon },
    { value: "system", label: "System", icon: Monitor },
  ];

  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => {
        const Icon = option.icon;
        const active = mode === option.value;
        return (
          <Button
            key={option.value}
            type="button"
            size="sm"
            variant={active ? "default" : "outline"}
            className={active ? "bg-orange-500 hover:bg-orange-600" : ""}
            onClick={() => setTheme(option.value)}
          >
            <Icon size={14} className="mr-1.5" />
            {option.label}
            {option.value === "system" && (
              <span className="ml-1 text-[10px] opacity-70">
                ({systemPrefersDark() ? "dark" : "light"})
              </span>
            )}
          </Button>
        );
      })}
    </div>
  );
}
