import { FileText, LayoutDashboard, ListChecks, Map as MapIcon } from 'lucide-react';

import type { Role } from '@/lib/auth/roles';

export interface NavItem {
  href: string;
  label: string;
  description: string;
  icon: typeof LayoutDashboard;
  /** Tanımlıysa yalnızca bu roller görür. */
  roles?: readonly Role[];
}

export const NAV_ITEMS: readonly NavItem[] = [
  {
    href: '/dashboard',
    label: 'Panel',
    description: 'Özet göstergeler',
    icon: LayoutDashboard,
  },
  {
    href: '/review',
    label: 'İnceleme kuyruğu',
    description: 'Manuel karar bekleyenler',
    icon: ListChecks,
    roles: ['moderator', 'municipality_admin'],
  },
  {
    href: '/reports',
    label: 'İhbarlar',
    description: 'Tüm kayıtlar',
    icon: FileText,
  },
  {
    href: '/map',
    label: 'Harita',
    description: 'Nokta ve H3 analizi',
    icon: MapIcon,
  },
];

export function visibleNavItems(role: Role): NavItem[] {
  return NAV_ITEMS.filter((item) => !item.roles || item.roles.includes(role));
}

export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function pageTitle(pathname: string): string {
  const match = NAV_ITEMS.find((item) => isActivePath(pathname, item.href));
  return match?.label ?? 'Panel';
}
