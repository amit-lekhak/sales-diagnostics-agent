'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { clsx } from 'clsx';

const links = [
  { href: '/', label: 'Overview' },
  { href: '/orders', label: 'Orders' },
  { href: '/products', label: 'Products' },
  { href: '/stores', label: 'Stores' },
  { href: '/analytics', label: 'Analytics' },
  { href: '/context', label: 'Context' },
  { href: '/ops', label: 'Agent ops' },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="flex w-56 shrink-0 flex-col bg-(--sidebar) px-4 py-6 text-[#f5f0e8]">
      <div className="px-2">
        <p className="text-[11px] uppercase tracking-[0.18em] text-teal-400">
          Northstar Mart
        </p>
        <h1 className="mt-1 text-lg font-semibold">Sales desk</h1>
      </div>
      <nav className="mt-8 flex flex-col gap-1">
        {links.map((l) => {
          const active = l.href === '/' ? pathname === '/' : pathname.startsWith(l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              className={clsx(
                'rounded-md px-3 py-2 text-sm',
                active
                  ? 'bg-white/10 text-white'
                  : 'text-stone-400 hover:bg-white/5 hover:text-white',
              )}
            >
              {l.label}
            </Link>
          );
        })}
      </nav>
      <p className="mt-auto px-2 text-xs leading-5 text-stone-500">
        Numbers come from Postgres. The chat cannot invent a sales figure.
      </p>
    </aside>
  );
}
