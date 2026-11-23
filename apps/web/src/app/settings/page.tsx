import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LinkWallet } from "@/components/wallet/link-wallet";
import { TelegramLink } from "./telegram-link";
import { getCurrentUser } from "@/lib/server/auth";
import { AccountConnect, ACCOUNT_NOTICES } from "@/components/accounts/account-connect";
import { accountRows } from "@/lib/server/account-rows";
import Link from "next/link";

export const metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function Settings({ searchParams }: { searchParams: Promise<{ account?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/settings");
  const { account: notice } = await searchParams;
  const rows = await accountRows(user.id);
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
      <Card id="accounts">
        <CardHeader>
          <CardTitle>Connected accounts</CardTitle>
          <CardDescription>
            Connect an account and challenges based on it verify and settle themselves, no verifiers needed.{" "}
            <Link href="/connected" className="text-primary underline-offset-4 hover:underline">See your data and suggested challenges</Link>
          </CardDescription>
        </CardHeader>
        <CardContent>
          {notice && ACCOUNT_NOTICES[notice] && <p className="mb-4 rounded-md bg-warning/10 px-3 py-2 text-sm text-warning" role="status">{ACCOUNT_NOTICES[notice]}</p>}
          {rows.map((r) => <AccountConnect key={r.slug} row={r} next="/settings#accounts" />)}
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
