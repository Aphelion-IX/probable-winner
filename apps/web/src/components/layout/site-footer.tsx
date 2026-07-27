import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="border-t border-white/10 bg-background/30 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-8 text-sm text-muted-foreground sm:px-6 md:flex-row md:items-center md:justify-between">
        <p>&copy; {new Date().getFullYear()} Common Ground Co. All rights reserved.</p>
        <nav className="flex flex-wrap gap-x-6 gap-y-2">
          <Link href="/account" className="hover:text-foreground">
            Account
          </Link>
          <Link href="/orders" className="hover:text-foreground">
            Orders
          </Link>
          <Link href="/saved-lists" className="hover:text-foreground">
            Saved Lists
          </Link>
        </nav>
      </div>
    </footer>
  );
}
