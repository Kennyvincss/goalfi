import { ChallengeBrowser, type BrowserParams } from "@/components/listing/challenge-browser";
import { getCurrentUser } from "@/lib/server/auth";

export const metadata = { title: "Markets" };
export const dynamic = "force-dynamic";

export default async function Markets({ searchParams }: { searchParams: Promise<BrowserParams> }) {
  const [params, user] = await Promise.all([searchParams, getCurrentUser()]);
  return (
    <div className="mx-auto max-w-7xl px-4 py-10">
      <h1 className="text-3xl font-bold tracking-tight">Prediction markets</h1>
      <p className="mt-1 text-muted-foreground">On-chain Predict pm-AMM markets on challenge outcomes. Prices are implied probabilities.</p>
      <div className="mt-8"><ChallengeBrowser basePath="/markets" params={params} viewerId={user?.id ?? null} marketsOnly /></div>
    </div>
  );
}
