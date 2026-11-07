import {
  PRODUCT_MODULE_CATALOG,
  type ModulePilotsState,
  type ProductModuleKey,
  type ProductModulesState,
} from '@fitgo/shared-types';

const PILOT_USER_LIMIT = 30;

/** Parse AppFeatureFlags.pilots JSON into a typed map of user id lists. */
export function parsePilots(raw: unknown): ModulePilotsState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: ModulePilotsState = {};
  for (const def of PRODUCT_MODULE_CATALOG) {
    if (!def.pilotable) continue;
    const value = (raw as Record<string, unknown>)[def.key];
    if (!Array.isArray(value)) continue;
    const ids = [
      ...new Set(
        value.filter(
          (id): id is string => typeof id === 'string' && id.trim().length > 0,
        ),
      ),
    ].slice(0, PILOT_USER_LIMIT);
    if (ids.length) out[def.key] = ids;
  }
  return out;
}

/**
 * Overlay pilot allow-lists onto the global module map for one user.
 * Globally ON modules stay ON for everyone; pilots only lift OFF → ON.
 */
export function applyPilotsForUser(
  modules: ProductModulesState,
  pilots: ModulePilotsState,
  userId: string,
): ProductModulesState {
  if (!userId) return { ...modules };
  const next = { ...modules };
  for (const def of PRODUCT_MODULE_CATALOG) {
    if (!def.pilotable) continue;
    if (next[def.key] !== false) continue;
    const ids = pilots[def.key];
    if (ids?.includes(userId)) {
      next[def.key] = true;
    }
  }
  return next;
}

export function isPilotableKey(key: string): key is ProductModuleKey {
  return PRODUCT_MODULE_CATALOG.some((d) => d.key === key && d.pilotable);
}

export { PILOT_USER_LIMIT };
