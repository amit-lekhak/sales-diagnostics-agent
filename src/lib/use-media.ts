'use client';

import { useSyncExternalStore } from 'react';

function subscribeMd(onChange: () => void) {
  const mq = window.matchMedia('(min-width: 768px)');
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

/** True when viewport is at least Tailwind `md` (768px). SSR defaults to false (mobile-first). */
export function useIsMd() {
  return useSyncExternalStore(
    subscribeMd,
    () => window.matchMedia('(min-width: 768px)').matches,
    () => false,
  );
}
