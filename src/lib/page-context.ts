export type PageName =
  'overview' | 'orders' | 'products' | 'stores' | 'analytics' | 'context' | 'ops';

export type PageContext = {
  page: PageName;
  pathname: string;
  from?: string;
  to?: string;
  storeId?: number;
  productId?: number;
  regionId?: number;
  status?: string;
  /** Human labels for chat chip (optional; filled client-side). */
  storeLabel?: string;
  productLabel?: string;
  regionLabel?: string;
};

export type ChatScope = 'page' | 'all';

export function describePageContext(ctx: PageContext, scope: ChatScope): string {
  if (scope === 'all') return 'All company data';
  const bits = [labelForPage(ctx.page)];
  if (ctx.from && ctx.to) bits.push(`${ctx.from} → ${ctx.to}`);
  if (ctx.storeId) bits.push(ctx.storeLabel ?? `store #${ctx.storeId}`);
  if (ctx.productId) bits.push(ctx.productLabel ?? `product #${ctx.productId}`);
  if (ctx.regionId) bits.push(ctx.regionLabel ?? `region #${ctx.regionId}`);
  if (ctx.status) bits.push(ctx.status);
  return bits.join(' · ');
}

export function labelForPage(page: PageName): string {
  const map: Record<PageName, string> = {
    overview: 'Overview',
    orders: 'Orders',
    products: 'Products',
    stores: 'Stores',
    analytics: 'Analytics',
    context: 'Context',
    ops: 'Agent ops',
  };
  return map[page];
}

export function pageFromPathname(pathname: string): PageName {
  if (pathname.startsWith('/orders')) return 'orders';
  if (pathname.startsWith('/products')) return 'products';
  if (pathname.startsWith('/stores')) return 'stores';
  if (pathname.startsWith('/analytics')) return 'analytics';
  if (pathname.startsWith('/context')) return 'context';
  if (pathname.startsWith('/ops')) return 'ops';
  return 'overview';
}
