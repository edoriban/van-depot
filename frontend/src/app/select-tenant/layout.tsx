import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Seleccionar empresa | Van Depot',
  description: 'Selecciona la empresa con la que deseas trabajar en Van Depot.',
};

export default function SelectTenantLayout({ children }: { children: React.ReactNode }) {
  return children;
}
