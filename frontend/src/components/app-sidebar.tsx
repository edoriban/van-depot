'use client';

import { useAuthStore } from '@/stores/auth-store';
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
  Package01Icon,
  DeliveryTruck01Icon,
  ArrowDataTransferHorizontalIcon,
  ClipboardIcon,
  CheckListIcon,
  Alert02Icon,
  Analytics01Icon,
  UserGroupIcon,
  Logout01Icon,
} from '@hugeicons/core-free-icons';
import { ThemeToggle } from '@/components/shared/theme-toggle';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface NavItem {
  title: string;
  href: string;
  icon: Parameters<typeof HugeiconsIcon>[0]['icon'];
}

interface NavGroup {
  label: string | null;
  items: NavItem[];
}

const navGroups: NavGroup[] = [
  {
    label: null,
    items: [
      { title: 'Dashboard', href: '/dashboard', icon: DashboardSquare01Icon },
    ],
  },
  {
    label: 'Catalogo',
    items: [
      { title: 'Productos', href: '/productos', icon: Package01Icon },
      { title: 'Proveedores', href: '/proveedores', icon: DeliveryTruck01Icon },
    ],
  },
  {
    label: 'Almacen',
    items: [
      { title: 'Almacenes', href: '/almacenes', icon: Store01Icon },
      { title: 'Inventario', href: '/inventory', icon: ClipboardIcon },
      { title: 'Alertas', href: '/alertas', icon: Alert02Icon },
    ],
  },
  {
    label: 'Operaciones',
    items: [
      { title: 'Movimientos', href: '/movements', icon: ArrowDataTransferHorizontalIcon },
      { title: 'Conteos', href: '/cycle-counts', icon: CheckListIcon },
    ],
  },
  {
    label: 'Analisis',
    items: [
      { title: 'Clasificacion ABC', href: '/clasificacion-abc', icon: Analytics01Icon },
    ],
  },
];

const adminGroup: NavGroup = {
  label: 'Administracion',
  items: [
    { title: 'Usuarios', href: '/users', icon: UserGroupIcon },
  ],
};

function isActive(pathname: string, href: string): boolean {
  if (href === '/dashboard') return pathname === href;
  return pathname === href || pathname.startsWith(href + '/');
}

export function AppSidebar() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const pathname = usePathname();

  const isAdmin = user?.role === 'superadmin' || user?.role === 'owner';

  const renderGroup = (group: NavGroup, index: number) => (
    <SidebarGroup key={group.label ?? `group-${index}`}>
      {group.label && <SidebarGroupLabel>{group.label}</SidebarGroupLabel>}
      <SidebarGroupContent>
        <SidebarMenu>
          {group.items.map((item) => (
            <SidebarMenuItem key={item.href}>
              <SidebarMenuButton asChild isActive={isActive(pathname, item.href)}>
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
  );

  return (
    <Sidebar>
      <SidebarHeader className="border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <HugeiconsIcon icon={Store01Icon} size={24} className="text-primary" />
          <span className="text-lg font-semibold">VanDepot</span>
        </div>
      </SidebarHeader>

      <SidebarContent>
        {navGroups.map((group, i) => renderGroup(group, i))}
        {isAdmin && renderGroup(adminGroup, navGroups.length)}
      </SidebarContent>

      <SidebarFooter className="border-t p-4">
        <div className="flex items-center justify-between">
          <div className="flex flex-col text-sm">
            <span className="font-medium">{user?.name}</span>
            <span className="text-muted-foreground text-xs">{user?.role}</span>
          </div>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <button
              onClick={logout}
              className="text-muted-foreground hover:text-foreground transition-colors p-1"
              aria-label="Cerrar sesion"
            >
              <HugeiconsIcon icon={Logout01Icon} size={18} />
            </button>
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
