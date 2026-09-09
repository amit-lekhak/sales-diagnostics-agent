'use client';

import { useSyncExternalStore, type ReactNode } from 'react';

function subscribe() {
  return () => {};
}

export function ChartFrame({
  heightClass,
  children,
}: {
  heightClass: string;
  children: ReactNode;
}) {
  const ready = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  if (!ready) {
    return <div className={`${heightClass} w-full`} />;
  }
  return <div className={`${heightClass} w-full`}>{children}</div>;
}
