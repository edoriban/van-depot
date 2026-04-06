'use client';

import { useTheme } from 'next-themes';
import { useEffect, useRef } from 'react';

/**
 * Automatically switches between light and dark mode based on time of day
 * when the theme is set to 'auto'.
 *
 * Night hours: 20:00 - 05:59 -> dark
 * Day hours:   06:00 - 19:59 -> light
 *
 * Useful for warehouse tablets without OS-level scheduling.
 */
export function useAutoTheme() {
  const { theme, setTheme } = useTheme();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (theme !== 'auto') {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    function applyTimeBasedTheme() {
      const hour = new Date().getHours();
      const isNight = hour >= 20 || hour < 6;
      const target = isNight ? 'dark' : 'light';

      // Apply via class directly to avoid infinite loop with setTheme
      const root = document.documentElement;
      root.classList.remove('light', 'dark');
      root.classList.add(target);
    }

    // Apply immediately
    applyTimeBasedTheme();

    // Re-check every minute to catch the transition at 6AM/8PM
    intervalRef.current = setInterval(applyTimeBasedTheme, 60_000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [theme, setTheme]);
}
