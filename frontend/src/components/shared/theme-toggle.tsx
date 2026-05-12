'use client';

import { useTheme } from 'next-themes';
import { useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { HugeiconsIcon } from '@hugeicons/react';
import { Sun01Icon, Moon01Icon, ComputerIcon, Clock01Icon } from '@hugeicons/core-free-icons';

const THEME_CYCLE = ['light', 'dark', 'system', 'auto'] as const;

const THEME_LABELS: Record<string, string> = {
  light: 'Modo claro',
  dark: 'Modo oscuro',
  system: 'Seguir sistema',
  auto: 'Automatico por horario',
};

const THEME_ICONS: Record<string, typeof Sun01Icon> = {
  light: Sun01Icon,
  dark: Moon01Icon,
  system: ComputerIcon,
  auto: Clock01Icon,
};

const emptySubscribe = () => () => {};
const getMountedSnapshot = () => true;
const getServerSnapshot = () => false;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(emptySubscribe, getMountedSnapshot, getServerSnapshot);

  if (!mounted) return <Button variant="ghost" size="icon" className="size-8" disabled />;

  const currentTheme = theme ?? 'system';
  const currentIndex = THEME_CYCLE.indexOf(currentTheme as typeof THEME_CYCLE[number]);
  const nextIndex = (currentIndex + 1) % THEME_CYCLE.length;
  const nextTheme = THEME_CYCLE[nextIndex];

  const icon = THEME_ICONS[currentTheme] ?? Sun01Icon;
  const label = THEME_LABELS[currentTheme] ?? 'Tema';

  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-8"
      onClick={() => setTheme(nextTheme)}
      aria-label={`${label} - Cambiar a ${THEME_LABELS[nextTheme]}`}
      title={label}
    >
      <HugeiconsIcon icon={icon} className="size-4" />
    </Button>
  );
}
