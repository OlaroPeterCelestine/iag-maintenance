/**
 * Indirection so low-level modules (db/sync) can ask "may this role see it?"
 * without importing access-control, which would create an import cycle through
 * manager-settings. access-control registers the real check on load.
 *
 * The Go API enforces the same rules, so an unregistered gate only means the
 * client skips an optimisation — it never widens server-side access.
 */
type ModuleAccessGate = (moduleSlug: string, entityKey?: string) => boolean;

let gate: ModuleAccessGate | null = null;

export function setModuleAccessGate(fn: ModuleAccessGate) {
  gate = fn;
}

export function moduleAccessAllowed(moduleSlug: string, entityKey?: string): boolean {
  if (!gate) return true;
  try {
    return gate(moduleSlug, entityKey);
  } catch {
    return true;
  }
}
