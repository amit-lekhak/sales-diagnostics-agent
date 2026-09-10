'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
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

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="mt-8 flex flex-col gap-1">
      {links.map((l) => {
        const active = l.href === '/' ? pathname === '/' : pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            onClick={onNavigate}
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
  );
}

function Brand() {
  return (
    <div className="px-2">
      <p className="text-[11px] uppercase tracking-[0.18em] text-teal-400">
        Northstar Mart
      </p>
      <h1 className="mt-1 text-lg font-semibold">Sales desk</h1>
    </div>
  );
}

function SidebarPanel({
  className,
  onNavigate,
}: {
  className?: string;
  onNavigate?: () => void;
}) {
  return (
    <aside
      className={clsx(
        'flex w-56 shrink-0 flex-col bg-(--sidebar) px-4 py-6 text-[#f5f0e8]',
        className,
      )}
    >
      <Brand />
      <NavLinks onNavigate={onNavigate} />
    </aside>
  );
}

export function Sidebar() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-(--line) bg-(--sidebar) px-4 py-3 text-[#f5f0e8] md:hidden">
        <button
          type="button"
          aria-label="Open menu"
          aria-expanded={open}
          onClick={() => setOpen(true)}
          className="rounded-md p-1.5 hover:bg-white/10"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path
              d="M3 5h14M3 10h14M3 15h14"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <div>
          <p className="text-[10px] uppercase tracking-[0.18em] text-teal-400">
            Northstar Mart
          </p>
          <p className="text-sm font-semibold leading-tight">Sales desk</p>
        </div>
      </header>

      {/* Desktop sidebar — fixed so it does not scroll with page content */}
      <SidebarPanel className="fixed inset-y-0 left-0 z-20 hidden h-screen overflow-y-auto md:flex" />
      <div className="hidden w-56 shrink-0 md:block" aria-hidden="true" />

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 bg-black/50"
            onClick={() => setOpen(false)}
          />
          <SidebarPanel
            className="relative z-10 h-full overflow-y-auto shadow-xl"
            onNavigate={() => setOpen(false)}
          />
        </div>
      )}
    </>
  );
}
