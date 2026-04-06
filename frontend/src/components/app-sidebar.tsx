'use client';

import { useAuth } from '@/features/auth/auth-context';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';
import { HugeiconsIcon } from '@hugeicons/react';
import {
  DashboardSquare01Icon,
  Store01Icon,
  Location01Icon,
  Package01Icon,
  Tag01Icon,
  DeliveryTruck01Icon,
  ArrowDataTransferHorizontalIcon,
  ClipboardIcon,
  CheckListIcon,
  UserGroupIcon,
  Logout01Icon,
} from '@hugeicons/core-free-icons';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const navItems = [
  { title: 'Dashboard', href: '/dashboard', icon: DashboardSquare01Icon },
  { title: 'Almacenes', href: '/almacenes', icon: Store01Icon },
  { title: 'Ubicaciones', href: '/ubicaciones', icon: Location01Icon },
  { title: 'Productos', href: '/productos', icon: Package01Icon },
  { title: 'Categorias', href: '/categorias', icon: Tag01Icon },
  { title: 'Proveedores', href: '/proveedores', icon: DeliveryTruck01Icon },
  { title: 'Movimientos', href: '/movements', icon: ArrowDataTransferHorizontalIcon },
  { title: 'Inventario', href: '/inventory', icon: ClipboardIcon },
  { title: 'Conteos', href: '/cycle-counts', icon: CheckListIcon },
];

const adminItems = [
  { title: 'Usuarios', href: '/users', icon: UserGroupIcon },
];

export function AppSidebar() {
  const { user, logout } = useAuth();
  const pathname = usePathname();

  const isAdmin = user?.role === 'superadmin' || user?.role === 'owner';

  return (
    <Sidebar>
      <SidebarHeader className="border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <HugeiconsIcon icon={Store01Icon} size={24} className="text-primary" />
          <span className="text-lg font-semibold">VanDepot</span>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navegacion</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton asChild isActive={pathname === item.href}>
                    <Link href={item.href}>
                      <HugeiconsIcon icon={item.icon} size={18} />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {isAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel>Administracion</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {adminItems.map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={pathname === item.href}>
                      <Link href={item.href}>
                        <HugeiconsIcon icon={item.icon} size={18} />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="border-t p-4">
        <div className="flex items-center justify-between">
          <div className="flex flex-col text-sm">
            <span className="font-medium">{user?.name}</span>
            <span className="text-muted-foreground text-xs">{user?.role}</span>
          </div>
          <button
            onClick={logout}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Cerrar sesion"
          >
            <HugeiconsIcon icon={Logout01Icon} size={18} />
          </button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
