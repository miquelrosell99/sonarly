import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

interface AdminRefreshContextValue {
  refreshKey: number;
  refresh: () => void;
}

const AdminRefreshContext = createContext<AdminRefreshContextValue | undefined>(undefined);

interface AdminRefreshProviderProps {
  children: ReactNode;
}

export function AdminRefreshProvider({ children }: AdminRefreshProviderProps) {
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  return (
    <AdminRefreshContext.Provider value={{ refreshKey, refresh }}>
      {children}
    </AdminRefreshContext.Provider>
  );
}

export function useAdminRefresh() {
  const ctx = useContext(AdminRefreshContext);
  if (!ctx) {
    throw new Error('useAdminRefresh must be used within an AdminRefreshProvider');
  }
  return ctx;
}
