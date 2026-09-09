'use client';

import { createContext, useContext, useMemo } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { pageFromPathname, type ChatScope, type PageContext } from '@/lib/page-context';

const Ctx = createContext<PageContext>({ page: 'overview', pathname: '/' });

export function PageContextProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const sp = useSearchParams();
  const value = useMemo<PageContext>(() => {
    const storeId = sp.get('storeId');
    const productId = sp.get('productId');
    const regionId = sp.get('regionId');
    return {
      page: pageFromPathname(pathname),
      pathname,
      from: sp.get('from') ?? undefined,
      to: sp.get('to') ?? undefined,
      storeId: storeId ? Number(storeId) : undefined,
      productId: productId ? Number(productId) : undefined,
      regionId: regionId ? Number(regionId) : undefined,
      status: sp.get('status') ?? undefined,
    };
  }, [pathname, sp]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePageContext(): PageContext {
  return useContext(Ctx);
}

export type { ChatScope };
