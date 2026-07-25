import {
  Activity,
  ArrowLeftRight,
  BarChart3,
  Boxes,
  Handshake,
  LayoutDashboard,
  PackageCheck,
  PackagePlus,
  Settings,
  Store,
  Tag,
  Target,
  Users,
  type LucideIcon,
} from "lucide-react";

export interface StaffNavLink {
  href: string;
  label: string;
  icon: LucideIcon;
}

export interface StaffNavSection {
  label: string;
  links: StaffNavLink[];
}

// Grouped to mirror the permission namespaces in docs/architecture.md §18
// (catalogue.*, inventory.*, orders.*, pricing.*, stores.*, users.*), even
// though nav items aren't permission-gated yet (getStaffContext() doesn't
// return a role/permission list -- see that function for the gap).
export const STAFF_NAV_SECTIONS: StaffNavSection[] = [
  {
    label: "Overview",
    links: [{ href: "/staff/dashboard", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    label: "Fulfilment",
    links: [
      { href: "/staff/orders", label: "Orders", icon: Boxes },
      { href: "/staff/picking", label: "Picking", icon: Target },
      { href: "/staff/packing", label: "Packing", icon: PackageCheck },
      { href: "/staff/handover", label: "Handover", icon: Handshake },
    ],
  },
  {
    label: "Catalogue & Inventory",
    links: [
      { href: "/staff/inventory", label: "Inventory", icon: Boxes },
      { href: "/staff/receiving", label: "Receiving", icon: PackagePlus },
      { href: "/staff/transfers", label: "Transfers", icon: ArrowLeftRight },
      { href: "/staff/pricing", label: "Pricing", icon: Tag },
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
      { href: "/staff/stores", label: "Stores", icon: Store },
      { href: "/staff/customers", label: "Customers", icon: Users },
      { href: "/staff/settings", label: "Settings", icon: Settings },
    ],
  },
];

export const STAFF_NAV_LINKS: StaffNavLink[] = STAFF_NAV_SECTIONS.flatMap(
  (section) => section.links,
);
