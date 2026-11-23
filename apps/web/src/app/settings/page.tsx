import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LinkWallet } from "@/components/wallet/link-wallet";
import { TelegramLink } from "./telegram-link";
import { getCurrentUser } from "@/lib/server/auth";
import { FitnessConnect } from "@/components/fitness/fitness-connect";
import { fitnessConfig } from "@/lib/server/fitness";
import { getFitnessConnection } from "@goalfi/services";
import { services } from "@/lib/server/services";
import Link from "next/link";

export const metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function Settings({ searchParams }: { searchParams: Promise<{ fitness?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/settings");
  const { fitness } = await searchParams;
  const conn = await getFitnessConnection(services(), user.id);
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-10">
      <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
      <Card>
        <CardHeader><CardTitle>Account</CardTitle></CardHeader>
        <CardContent className="grid gap-2 text-sm">
          <div><span className="text-muted-foreground">Username:</span> @{user.username}</div>
          {user.email && <div><span className="text-muted-foreground">Email:</span> {user.email}</div>}
          <div><span className="text-muted-foreground">Reputation:</span> {user.reputationScore}</div>
        </CardContent>
      </Card>
      <Card id="wallet">
        <CardHeader>
          <CardTitle>Solana wallet</CardTitle>
          <CardDescription>Only needed for trading. Phantom, Solflare and other Wallet Standard wallets are supported.</CardDescription>
        </CardHeader>
        <CardContent><LinkWallet linked={user.walletAddress} /></CardContent>
      </Card>
      <Card id="fitness">
        <CardHeader>
          <CardTitle>Fitness accounts</CardTitle>
          <CardDescription>
            Connect a fitness account so step challenges verify themselves, no verifiers needed.{" "}
            {conn && <Link href="/fitness" className="text-primary underline-offset-4 hover:underline">See your steps and suggested challenges</Link>}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FitnessConnect
            connected={!!conn}
            status={conn?.status}
            lastSyncAt={conn?.lastSyncAt?.toISOString() ?? null}
            lastError={conn?.lastError ?? null}
            available={!!fitnessConfig()}
            notice={fitness}
          />
        </CardContent>
      </Card>
      <Card id="telegram">
        <CardHeader>
          <CardTitle>Telegram</CardTitle>
          <CardDescription>Get reminders and review requests, and connect your groups.</CardDescription>
        </CardHeader>
        <CardContent>
          {user.telegramId ? (
            <p className="text-sm">Connected{user.telegramUsername ? <> as <b>@{user.telegramUsername}</b></> : null}.</p>
          ) : <TelegramLink />}
        </CardContent>
      </Card>
    </div>
  );
}
