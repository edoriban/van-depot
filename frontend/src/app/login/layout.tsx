import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Iniciar sesión | Van Depot',
  description: 'Inicia sesión en Van Depot para acceder a tu sistema de gestión de inventario.',
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
