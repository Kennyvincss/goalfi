import { ChallengeBrowser, type BrowserParams } from "@/components/listing/challenge-browser";
import { getCurrentUser } from "@/lib/server/auth";

export const metadata = { title: "Discover" };
export const dynamic = "force-dynamic";

export default async function Discover({ searchParams }: { searchParams: Promise<BrowserParams> }) {
  const [params, user] = await Promise.all([searchParams, getCurrentUser()]);
  return (
    <div className="mx-auto max-w-7xl px-4 py-10">
      <h1 className="text-3xl font-bold tracking-tight">Discover</h1>
      <p className="mt-1 text-muted-foreground">Public challenges from every community. No Telegram needed.</p>
      <div className="mt-8"><ChallengeBrowser basePath="/discover" params={params} viewerId={user?.id ?? null} /></div>
    </div>
  );
}
