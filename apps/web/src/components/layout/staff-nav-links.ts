import {
  Activity,
  ArrowLeftRight,
  BarChart3,
  Boxes,
  ClipboardList,
  Handshake,
  LayoutDashboard,
  PackageCheck,
  PackagePlus,
  Settings,
  Store,
  Tag,
  Target,
  Truck,
  Users,
  type LucideIcon,
} from "lucide-react";

export interface StaffNavLink {
  href: string;
  label: string;
  icon: LucideIcon;
  /**
   * Permission required to see this link (blueprint §18). Omitted where a
   * screen is safe for any staff member — the dashboard, and screens whose
   * own queries are already scoped to what the viewer may read.
   */
  permission?: string;
}

export interface StaffNavSection {
  label: string;
  links: StaffNavLink[];
}

// Grouped to mirror the permission namespaces in docs/architecture.md §18
// (catalogue.*, inventory.*, orders.*, pricing.*, stores.*, users.*).
export const STAFF_NAV_SECTIONS: StaffNavSection[] = [
  {
    label: "Overview",
    links: [{ href: "/staff/dashboard", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    label: "Fulfilment",
    links: [
      { href: "/staff/orders", label: "Orders", icon: Boxes, permission: "orders.view" },
      { href: "/staff/picking", label: "Picking", icon: Target, permission: "orders.pick" },
      { href: "/staff/packing", label: "Packing", icon: PackageCheck, permission: "orders.pack" },
      { href: "/staff/shipping", label: "Shipping", icon: Truck, permission: "orders.pack" },
      { href: "/staff/handover", label: "Handover", icon: Handshake, permission: "orders.view" },
    ],
  },
  {
    label: "Catalogue & Inventory",
    links: [
      { href: "/staff/inventory", label: "Inventory", icon: Boxes, permission: "inventory.view" },
      {
        href: "/staff/receiving",
        label: "Receiving",
        icon: PackagePlus,
        permission: "inventory.receive",
      },
      {
        href: "/staff/transfers",
        label: "Transfers",
        icon: ArrowLeftRight,
        permission: "inventory.transfer",
      },
      {
        href: "/staff/stocktakes",
        label: "Stocktakes",
        icon: ClipboardList,
        permission: "inventory.stocktake",
      },
      { href: "/staff/pricing", label: "Pricing", icon: Tag, permission: "pricing.view" },
    ],
  },
  {
    label: "Insights",
    links: [
      { href: "/staff/analytics", label: "Analytics", icon: BarChart3 },
      { href: "/staff/monitoring", label: "Monitoring", icon: Activity },
    ],
  },
  {
    label: "Organisation",
    links: [
      { href: "/staff/stores", label: "Stores", icon: Store, permission: "stores.view" },
      { href: "/staff/customers", label: "Customers", icon: Users, permission: "users.view" },
      { href: "/staff/settings", label: "Settings", icon: Settings },
    ],
  },
];

export const STAFF_NAV_LINKS: StaffNavLink[] = STAFF_NAV_SECTIONS.flatMap(
  (section) => section.links,
);

/**
 * Drops links the viewer lacks the permission for, then drops any section
 * left with nothing in it.
 *
 * This is presentation only — hiding a link is not access control. Each
 * screen's own action still checks the permission, and RLS is the real
 * boundary underneath both.
 */
export function visibleNavSections(permissions: string[]): StaffNavSection[] {
  const granted = new Set(permissions);

  return STAFF_NAV_SECTIONS.map((section) => ({
    ...section,
    links: section.links.filter((link) => !link.permission || granted.has(link.permission)),
  })).filter((section) => section.links.length > 0);
}
