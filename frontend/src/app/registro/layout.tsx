import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Crear cuenta | Van Depot',
  description: 'Crea una cuenta nueva en Van Depot y comienza a gestionar tu inventario.',
};

export default function RegistroLayout({ children }: { children: React.ReactNode }) {
  return children;
}
