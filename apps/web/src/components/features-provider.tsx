'use client';

import {
  DEFAULT_PRODUCT_MODULES,
  type ProductModuleKey,
  type ProductModulesState,
} from '@fitgo/shared-types';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';

const FEATURES_CACHE_KEY = 'fitgo.productModules.v1';

function readCachedModules(): ProductModulesState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(FEATURES_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ProductModulesState>;
    return { ...DEFAULT_PRODUCT_MODULES, ...parsed };
  } catch {
    return null;
  }
}

function writeCachedModules(modules: ProductModulesState) {
  try {
    sessionStorage.setItem(FEATURES_CACHE_KEY, JSON.stringify(modules));
  } catch {
    /* ignore quota / private mode */
  }
}

const FeaturesContext = createContext<{
  modules: ProductModulesState;
  loading: boolean;
  isEnabled: (key: ProductModuleKey) => boolean;
  refresh: () => void;
}>({
  modules: DEFAULT_PRODUCT_MODULES,
  loading: true,
  isEnabled: () => true,
  refresh: () => {},
});

export function useFeatures() {
  return useContext(FeaturesContext);
}

export function FeaturesProvider({ children }: { children: ReactNode }) {
  const [modules, setModules] = useState<ProductModulesState>(
    () => readCachedModules() ?? DEFAULT_PRODUCT_MODULES,
  );
  const [loading, setLoading] = useState(() => readCachedModules() == null);

  const refresh = useCallback(() => {
    const token = getToken();
    if (!token) {
      setModules(DEFAULT_PRODUCT_MODULES);
      setLoading(false);
      return;
    }
    api
      .features(token)
      .then((res) => {
        const next = { ...DEFAULT_PRODUCT_MODULES, ...res.modules };
        setModules(next);
        writeCachedModules(next);
      })
      .catch(() => {
        // Keep last known modules (cache / prior fetch) — never flash defaults mid-session.
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    let lastToken = getToken();
    refresh();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        const next = getToken();
        if (next !== lastToken) {
          lastToken = next;
          refresh();
        }
      }
    };
    const id = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      const next = getToken();
      if (next !== lastToken) {
        lastToken = next;
        refresh();
      }
    }, 4000);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refresh]);

  const isEnabled = useCallback(
    (key: ProductModuleKey) => modules[key] !== false,
    [modules],
  );

  const value = useMemo(
    () => ({
      modules,
      loading,
      isEnabled,
      refresh,
    }),
    [modules, loading, isEnabled, refresh],
  );

  return (
    <FeaturesContext.Provider value={value}>{children}</FeaturesContext.Provider>
  );
}
