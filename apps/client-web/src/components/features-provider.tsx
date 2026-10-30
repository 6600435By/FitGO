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
  const [modules, setModules] = useState<ProductModulesState>(DEFAULT_PRODUCT_MODULES);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    const token = getToken();
    if (!token) {
      setModules(DEFAULT_PRODUCT_MODULES);
      setLoading(false);
      return;
    }
    api
      .features(token)
      .then((res) => setModules({ ...DEFAULT_PRODUCT_MODULES, ...res.modules }))
      .catch(() => setModules(DEFAULT_PRODUCT_MODULES))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    let lastToken = getToken();
    refresh();
    const id = window.setInterval(() => {
      const next = getToken();
      if (next !== lastToken) {
        lastToken = next;
        refresh();
      }
    }, 1500);
    return () => window.clearInterval(id);
  }, [refresh]);

  const value = useMemo(
    () => ({
      modules,
      loading,
      isEnabled: (key: ProductModuleKey) => modules[key] !== false,
      refresh,
    }),
    [modules, loading, refresh],
  );

  return (
    <FeaturesContext.Provider value={value}>{children}</FeaturesContext.Provider>
  );
}
