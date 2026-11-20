"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { MAIN_NAV } from "./nav-links";

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function NavLinks() {
  const pathname = usePathname();
  return (
    <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
      {MAIN_NAV.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className={cn(
            "rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground",
            isActive(pathname, l.href) && "bg-muted text-foreground",
          )}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  return (
    <div className="md:hidden">
      <button className="grid size-10 place-items-center rounded-md hover:bg-muted" onClick={() => setOpen((o) => !o)} aria-label="Menu" aria-expanded={open}>
        {open ? <X className="size-5" /> : <Menu className="size-5" />}
      </button>
      {open && (
        <nav className="absolute inset-x-0 top-16 border-b bg-background p-3 shadow-lg" aria-label="Mobile">
          {MAIN_NAV.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className={cn("block rounded-md px-3 py-3 font-medium", isActive(pathname, l.href) ? "bg-muted" : "text-muted-foreground")}
            >
              {l.label}
            </Link>
          ))}
          <Link href="/challenges/new" onClick={() => setOpen(false)} className="mt-2 block rounded-md bg-primary px-3 py-3 text-center font-medium text-primary-foreground">
            Create a challenge
          </Link>
        </nav>
      )}
    </div>
  );
}
