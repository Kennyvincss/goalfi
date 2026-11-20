import Link from "next/link";
import { Send, Users } from "lucide-react";
import { prisma } from "@goalfi/db";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";

export const metadata = { title: "Communities" };
export const dynamic = "force-dynamic";

export default async function Communities() {
  const communities = await prisma.community.findMany({
    where: { visibility: "PUBLIC" },
    orderBy: { members: { _count: "desc" } },
    take: 48,
    select: {
      slug: true, name: true, description: true, telegramChatId: true,
      _count: { select: { members: true, challenges: { where: { status: { in: ["ACTIVE", "UPCOMING"] } } } } },
    },
  });
  return (
    <div className="mx-auto max-w-7xl px-4 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Communities</h1>
          <p className="mt-1 text-muted-foreground">Groups that hold each other accountable.</p>
        </div>
        <Button asChild variant="outline"><Link href="/telegram"><Send />Connect a Telegram group</Link></Button>
      </div>
      <div className="mt-8">
        {communities.length === 0 ? (
          <EmptyState title="No public communities yet">Connect a Telegram group or create a community to get started.</EmptyState>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {communities.map((c) => (
              <Link key={c.slug} href={`/communities/${c.slug}`}>
                <Card className="h-full p-5 transition-shadow hover:shadow-md">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold">{c.name}</h3>
                    {c.telegramChatId && <Badge variant="outline"><Send className="size-3" />Telegram</Badge>}
                  </div>
                  {c.description && <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{c.description}</p>}
                  <div className="mt-4 flex gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><Users className="size-3.5" />{c._count.members} members</span>
                    <span>{c._count.challenges} active challenges</span>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
