import Link from "next/link";
import { getCurrentUser } from "@/lib/server/auth";
import { Button } from "@/components/ui/button";
import { Logo } from "./logo";
import { NavLinks, MobileNav } from "./nav-client";
import { UserMenu } from "./user-menu";

export async function SiteHeader() {
  const user = await getCurrentUser();
  return (
    <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-4">
        <Logo />
        <NavLinks />
        <div className="ml-auto flex items-center gap-2">
          {user ? (
            <>
              <Button asChild size="sm" className="hidden sm:inline-flex">
                <Link href="/challenges/new">Create challenge</Link>
              </Button>
              <UserMenu username={user.username} displayName={user.displayName} isAdmin={user.role === "PLATFORM_ADMIN"} />
            </>
          ) : (
            <>
              <Button asChild variant="ghost" size="sm">
                <Link href="/login">Sign in</Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/signup">Get started</Link>
              </Button>
            </>
          )}
          <MobileNav />
        </div>
      </div>
    </header>
  );
}
