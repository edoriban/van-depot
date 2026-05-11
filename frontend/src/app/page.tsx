import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Van Depot',
  description: 'Sistema de gestión de almacén e inventario para PyMEs.',
};

export default function Home() {
  redirect('/inicio');
}
