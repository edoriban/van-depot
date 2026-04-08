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
  useSidebar,
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
  TaskDaily01Icon,
  Alert02Icon,
  Notification03Icon,
  Analytics01Icon,
  UserGroupIcon,
  Logout01Icon,
  Layers01Icon,
  Settings01Icon,
} from '@hugeicons/core-free-icons';
import { ThemeToggle } from '@/components/shared/theme-toggle';
import { useIsMobile } from '@/hooks/use-mobile';
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
      { title: 'Inicio', href: '/inicio', icon: DashboardSquare01Icon },
    ],
  },
  {
    label: 'Catalogo',
    items: [
      { title: 'Productos', href: '/productos', icon: Package01Icon },
      { title: 'Proveedores', href: '/proveedores', icon: DeliveryTruck01Icon },
      { title: 'Ordenes de Compra', href: '/proveedores/ordenes', icon: ClipboardIcon },
      { title: 'Lotes', href: '/lotes', icon: Layers01Icon },
    ],
  },
  {
    label: 'Almacen',
    items: [
      { title: 'Almacenes', href: '/almacenes', icon: Store01Icon },
      { title: 'Inventario', href: '/inventario', icon: ClipboardIcon },
      { title: 'Alertas', href: '/alertas', icon: Alert02Icon },
      { title: 'Notificaciones', href: '/notificaciones', icon: Notification03Icon },
    ],
  },
  {
    label: 'Operaciones',
    items: [
      { title: 'Movimientos', href: '/movimientos', icon: ArrowDataTransferHorizontalIcon },
      { title: 'Conteos Ciclicos', href: '/conteos-ciclicos', icon: CheckListIcon },
      { title: 'Recetas', href: '/recetas', icon: TaskDaily01Icon },
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
    { title: 'Usuarios', href: '/usuarios', icon: UserGroupIcon },
    { title: 'Config. Stock', href: '/configuracion-stock', icon: Settings01Icon },
  ],
};

// Collect all nav hrefs for precise active matching
const allNavHrefs: string[] = [
  ...navGroups.flatMap((g) => g.items.map((i) => i.href)),
  ...adminGroup.items.map((i) => i.href),
];

function isActive(pathname: string, href: string): boolean {
  if (href === '/inicio') return pathname === href;
  if (pathname === href) return true;
  if (pathname.startsWith(href + '/')) {
    // Check if a more specific nav item matches this pathname
    const hasMoreSpecificMatch = allNavHrefs.some(
      (other) =>
        other !== href &&
        other.length > href.length &&
        (pathname === other || pathname.startsWith(other + '/'))
    );
    return !hasMoreSpecificMatch;
  }
  return false;
}

export function AppSidebar() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const pathname = usePathname();
  const isMobile = useIsMobile();
  const { setOpenMobile } = useSidebar();

  const isAdmin = user?.role === 'superadmin' || user?.role === 'owner';

  // On mobile: first item is "Inicio" → /piso. On desktop: "Dashboard" → /dashboard
  const homeItem: NavItem = isMobile
    ? { title: 'Inicio', href: '/piso', icon: DashboardSquare01Icon }
    : { title: 'Inicio', href: '/inicio', icon: DashboardSquare01Icon };

  const dynamicNavGroups: NavGroup[] = [
    { label: null, items: [homeItem] },
    ...navGroups.slice(1), // skip the original dashboard group
  ];

  const renderGroup = (group: NavGroup, index: number) => (
    <SidebarGroup key={group.label ?? `group-${index}`}>
      {group.label && <SidebarGroupLabel>{group.label}</SidebarGroupLabel>}
      <SidebarGroupContent>
        <SidebarMenu>
          {group.items.map((item) => (
            <SidebarMenuItem key={item.href}>
              <SidebarMenuButton asChild isActive={isActive(pathname, item.href)}>
                <Link href={item.href} onClick={() => isMobile && setOpenMobile(false)}>
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
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/vanflux-icon.svg" alt="VanFlux" width={28} height={28} />
          <span className="text-lg font-semibold">VanFlux</span>
        </div>
      </SidebarHeader>

      <SidebarContent>
        {dynamicNavGroups.map((group, i) => renderGroup(group, i))}
        {isAdmin && renderGroup(adminGroup, dynamicNavGroups.length)}
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
