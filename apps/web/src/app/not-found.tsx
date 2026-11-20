import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md px-4 py-24 text-center">
      <h1 className="text-2xl font-bold">Not found</h1>
      <p className="mt-2 text-muted-foreground">This page doesn’t exist or isn’t visible to you.</p>
      <Button asChild className="mt-6"><Link href="/discover">Explore challenges</Link></Button>
    </div>
  );
}
