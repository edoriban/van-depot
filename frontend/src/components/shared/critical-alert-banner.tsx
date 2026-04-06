'use client';

import { useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { HugeiconsIcon } from '@hugeicons/react';
import { Alert02Icon, Cancel01Icon } from '@hugeicons/core-free-icons';
import type { AlertSummary } from '@/types';
import { cn } from '@/lib/utils';

export function CriticalAlertBanner() {
  const [dismissed, setDismissed] = useState(false);
  const { data } = useSWR<AlertSummary>('/alerts/summary', {
    refreshInterval: 60_000,
  });

  const criticalCount = data?.critical_count ?? 0;

  if (dismissed || criticalCount === 0) {
    return null;
  }

  return (
    <div
      className={cn(
        'hidden md:flex items-center justify-between gap-3',
        'bg-red-500/10 border-b border-red-500/20 px-4 py-2.5',
        'animate-in slide-in-from-top duration-300'
      )}
      role="alert"
    >
      <div className="flex items-center gap-2 text-sm">
        <HugeiconsIcon
          icon={Alert02Icon}
          size={18}
          className="text-red-600 dark:text-red-400 shrink-0"
        />
        <span className="text-red-700 dark:text-red-300 font-medium">
          Hay {criticalCount} {criticalCount === 1 ? 'producto' : 'productos'} en stock critico
        </span>
        <Link
          href="/alertas"
          className="text-red-700 dark:text-red-300 underline underline-offset-2 hover:text-red-900 dark:hover:text-red-100 font-semibold ml-1"
        >
          Ver alertas
        </Link>
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="text-red-600/70 hover:text-red-700 dark:text-red-400/70 dark:hover:text-red-300 shrink-0 p-0.5 rounded-sm"
        aria-label="Cerrar alerta"
      >
        <HugeiconsIcon icon={Cancel01Icon} size={16} />
      </button>
    </div>
  );
}
