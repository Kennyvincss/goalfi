import type { ReactNode } from "react";

/** Shared layout for the privacy policy and terms. */
export function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <article className="mx-auto max-w-3xl space-y-6 px-4 py-10 text-[15px] leading-relaxed [&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-semibold [&_li]:mt-1 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5 [&_a]:text-primary [&_a]:underline-offset-4 hover:[&_a]:underline">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">Last updated {updated}</p>
      </header>
      {children}
    </article>
  );
}

/** How to reach the operators: GOALFI_CONTACT_EMAIL if set. */
export function contactLine(): ReactNode {
  const email = process.env.GOALFI_CONTACT_EMAIL?.trim();
  return email ? <a href={`mailto:${email}`}>{email}</a> : <>the contact address published on this site</>;
}
