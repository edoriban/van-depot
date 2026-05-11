import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Recuperar contraseña | Van Depot',
  description: 'Recupera el acceso a tu cuenta de Van Depot restableciendo tu contraseña.',
};

export default function RecuperarLayout({ children }: { children: React.ReactNode }) {
  return children;
}
