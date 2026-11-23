import Link from "next/link";
import { prisma } from "@goalfi/db";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/server/auth";
import { TelegramActions } from "./add-to-group";

export const metadata = { title: "Telegram" };
export const dynamic = "force-dynamic";

const STEPS = [
  ["Start the GoalFi bot", "Opens a private chat with the official bot and links your Telegram account to GoalFi."],
  ["Choose a group", "Telegram shows your groups. Pick one where you’re an admin. You authorize the addition; nothing happens automatically."],
  ["Bot checks permissions", "The bot confirms it joined and that you are an administrator of that group (Telegram Bot API getChatMember)."],
  ["Community connected", "The group becomes a GoalFi community on your dashboard. New challenges, reminders, review requests and results are announced there."],
];

const COMMANDS = [
  ["/start", "Link your account or a group"], ["/help", "What the bot can do"], ["/dashboard", "Your stats and active challenges"],
  ["/challenges", "Challenges in this group"], ["/markets", "Live markets and prices"], ["/leaderboard", "Community rankings"],
  ["/submit", "Submit evidence (opens the website)"],
];

export default async function TelegramPage() {
  const user = await getCurrentUser();
  const [groups, unlinked] = user
    ? await Promise.all([
        prisma.community.findMany({ where: { members: { some: { userId: user.id, role: { in: ["OWNER", "ADMIN"] } } }, telegramChatId: { not: null } }, select: { slug: true, name: true, telegramTitle: true } }),
        prisma.community.findMany({ where: { members: { some: { userId: user.id, role: { in: ["OWNER", "ADMIN"] } } }, telegramChatId: null }, select: { id: true, name: true }, orderBy: { createdAt: "desc" } }),
      ])
    : [[], []];
  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-10">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">GoalFi for Telegram</h1>
        <p className="mt-1 max-w-2xl text-muted-foreground">Bring challenges to your group chat with announcements, reminders, review requests and results. The website stays the source of truth for every challenge and market.</p>
      </div>
      <Card>
        <CardHeader><CardTitle>Add GoalFi to your group</CardTitle></CardHeader>
        <CardContent className="space-y-6">
          <ol className="grid gap-4 sm:grid-cols-2">
            {STEPS.map(([t, d], i) => (
              <li key={t} className="flex gap-3">
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-accent text-sm font-semibold text-accent-foreground">{i + 1}</span>
                <div><div className="font-medium">{t}</div><p className="text-sm text-muted-foreground">{d}</p></div>
              </li>
            ))}
          </ol>
          {user ? <TelegramActions hasTelegram={!!user.telegramId} communities={unlinked} /> : (
            <Button asChild><Link href="/login?next=/telegram">Sign in to connect a group</Link></Button>
          )}
        </CardContent>
      </Card>
      {groups.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Your connected groups</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {groups.map((g) => <li key={g.slug}><Link className="hover:text-primary" href={`/communities/${g.slug}`}>{g.name}</Link>{g.telegramTitle && g.telegramTitle !== g.name && <span className="text-muted-foreground"> ↔ Telegram group “{g.telegramTitle}”</span>}</li>)}
            </ul>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader><CardTitle>Bot commands</CardTitle></CardHeader>
        <CardContent>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            {COMMANDS.map(([c, d]) => <div key={c} className="flex gap-3"><dt className="w-28 shrink-0 font-mono text-primary">{c}</dt><dd className="text-muted-foreground">{d}</dd></div>)}
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
