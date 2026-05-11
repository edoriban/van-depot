import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Activar cuenta | Van Depot',
  description: 'Activa tu cuenta de Van Depot para comenzar a usar la plataforma.',
};

export default function ActivarLayout({ children }: { children: React.ReactNode }) {
  return children;
}
