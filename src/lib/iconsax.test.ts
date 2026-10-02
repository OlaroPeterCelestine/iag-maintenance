import { describe, expect, it } from "vitest";
import { Element3, FolderOpen, Note1, Setting2, type Icon } from "iconsax-react";
import { NAV_MODULES } from "@/lib/module-data";
import { SIDEBAR_ITEM_ICONS, iconForNav, moduleIcons } from "@/lib/iconsax";

describe("sidebar icons", () => {
  it("assigns an icon to every primary sidebar tab", () => {
    const primary = NAV_MODULES.find((m) => m.slug === "production");
    expect(primary).toBeTruthy();
    const missing = (primary?.items || []).filter((label) => !SIDEBAR_ITEM_ICONS[label]);
    expect(missing, `tabs with no dedicated icon: ${missing.join(", ")}`).toEqual([]);
  });

  it("does not reuse an icon across sidebar tabs", () => {
    const used = new Map<Icon, string[]>();
    const register = (label: string, icon: Icon) => {
      const list = used.get(icon) || [];
      list.push(label);
      used.set(icon, list);
    };
    register("Overview", Element3);
    register("Documents", moduleIcons.documents);
    register("Settings", Setting2);
    register("Build log", Note1);
    expect(moduleIcons.documents).toBe(FolderOpen);
    const primary = NAV_MODULES.find((m) => m.slug === "production");
    for (const label of primary?.items || []) {
      register(label, iconForNav(label));
    }
    const dupes = [...used.entries()]
      .filter(([, labels]) => labels.length > 1)
      .map(([, labels]) => labels.join(" + "));
    expect(dupes).toEqual([]);
  });
});
