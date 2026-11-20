import { CHALLENGE_TEMPLATES, INITIAL_CATEGORIES } from "@goalfi/core";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CategoryIcon } from "@/components/category-icon";

export const metadata = { title: "Create a challenge" };

export default function NewChallenge() {
  const byCat = INITIAL_CATEGORIES.map((c) => ({ ...c, templates: CHALLENGE_TEMPLATES.filter((t) => t.category === c.slug) })).filter((c) => c.templates.length);
  return (
    <div className="mx-auto max-w-7xl px-4 py-10">
      <h1 className="text-3xl font-bold tracking-tight">Create a challenge</h1>
      <p className="mt-1 max-w-2xl text-muted-foreground">Start from a template; every field is editable. You’ll review a full summary and confirm the rules before anything goes live or any market is created.</p>
      <div className="mt-6 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
        The challenge builder, with on-chain market creation, is being rolled out next (Phase 3). Templates below show what you’ll be able to launch.
      </div>
      <div className="mt-8 space-y-10">
        {byCat.map((c) => (
          <section key={c.slug}>
            <h2 className="flex items-center gap-2 text-lg font-semibold"><CategoryIcon icon={c.icon} className="size-5 text-primary" />{c.name}</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {c.templates.map((t) => (
                <Card key={t.id} className="flex flex-col gap-3 p-5">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-semibold">{t.title}</h3>
                    <Badge variant="muted">{t.durationDays}d{t.recurrence !== "NONE" ? ` · ${t.recurrence.toLowerCase()}` : ""}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{t.description}</p>
                  <div className="mt-auto text-xs"><span className="font-medium">Success:</span> <span className="text-muted-foreground">{t.successCriteria}</span></div>
                  <div className="text-xs"><span className="font-medium">Market:</span> <span className="text-muted-foreground">{t.marketQuestion}</span></div>
                </Card>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
