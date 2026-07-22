import Link from "next/link";
import { Menu } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

const STAFF_NAV_LINKS = [
  { href: "/staff/dashboard", label: "Dashboard" },
  { href: "/staff/orders", label: "Orders" },
  { href: "/staff/inventory", label: "Inventory" },
  { href: "/staff/receiving", label: "Receiving" },
  { href: "/staff/transfers", label: "Transfers" },
  { href: "/staff/pricing", label: "Pricing" },
  { href: "/staff/picking", label: "Picking" },
  { href: "/staff/shipping", label: "Shipping" },
  { href: "/staff/stores", label: "Stores" },
  { href: "/staff/customers", label: "Customers" },
  { href: "/staff/settings", label: "Settings" },
];

export function StaffHeader() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background">
      <div className="mx-auto flex h-14 max-w-screen-2xl items-center gap-3 px-4 sm:px-6">
        <Sheet>
          <SheetTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden"
                aria-label="Open staff menu"
              />
            }
          >
            <Menu />
          </SheetTrigger>
          <SheetContent side="left" className="w-72 p-0">
            <SheetHeader className="border-b">
              <SheetTitle>Staff Portal</SheetTitle>
            </SheetHeader>
            <nav className="flex flex-col gap-1 p-4">
              {STAFF_NAV_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="rounded-md px-3 py-2 text-sm font-medium hover:bg-muted"
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          </SheetContent>
        </Sheet>

        <Link href="/staff/dashboard" className="shrink-0 text-sm font-semibold tracking-tight">
          Staff Portal
        </Link>

        <nav className="hidden items-center gap-1 overflow-x-auto lg:flex">
          {STAFF_NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-md px-2.5 py-2 text-sm font-medium whitespace-nowrap text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
