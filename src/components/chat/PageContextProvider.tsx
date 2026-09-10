'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { pageFromPathname, type ChatScope, type PageContext } from '@/lib/page-context';

const Ctx = createContext<PageContext>({ page: 'overview', pathname: '/' });

type LabelMaps = {
  regions: Map<number, string>;
  stores: Map<number, string>;
  products: Map<number, string>;
};

export function PageContextProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const sp = useSearchParams();
  const [labels, setLabels] = useState<LabelMaps>({
    regions: new Map(),
    stores: new Map(),
    products: new Map(),
  });

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/labels')
      .then((r) => r.json())
      .then(
        (j: {
          regions?: { id: number; name: string }[];
          stores?: { id: number; name: string }[];
          products?: { id: number; name: string }[];
        }) => {
          if (cancelled) return;
          setLabels({
            regions: new Map((j.regions ?? []).map((r) => [r.id, r.name])),
            stores: new Map((j.stores ?? []).map((s) => [s.id, s.name])),
            products: new Map((j.products ?? []).map((p) => [p.id, p.name])),
          });
        },
      )
      .catch(() => {
        /* chip falls back to #id */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<PageContext>(() => {
    const storeId = sp.get('storeId');
    const productId = sp.get('productId');
    const regionId = sp.get('regionId');
    const sid = storeId ? Number(storeId) : undefined;
    const pid = productId ? Number(productId) : undefined;
    const rid = regionId ? Number(regionId) : undefined;
    return {
      page: pageFromPathname(pathname),
      pathname,
      from: sp.get('from') ?? undefined,
      to: sp.get('to') ?? undefined,
      storeId: sid,
      productId: pid,
      regionId: rid,
      status: sp.get('status') ?? undefined,
      storeLabel: sid != null ? labels.stores.get(sid) : undefined,
      productLabel: pid != null ? labels.products.get(pid) : undefined,
      regionLabel: rid != null ? labels.regions.get(rid) : undefined,
    };
  }, [pathname, sp, labels]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePageContext(): PageContext {
  return useContext(Ctx);
}

export type { ChatScope };
