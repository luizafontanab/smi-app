import Link from "next/link";
import { requireConsole } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";
import { Badge } from "@/components/console/ui";
import { EMAIL_DEFAULTS, type EmailFamily } from "@/lib/email/defaults";
import { EDITABLE_KINDS } from "@/lib/email/templates";

export const dynamic = "force-dynamic";
export const metadata = { title: "Email Templates" };

const fmt = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

const FAMILIES: { key: EmailFamily; title: string; blurb: string }[] = [
  {
    key: "member",
    title: "Member emails",
    blurb: "Sent to a member when something of theirs changes — approved, sent back, scheduled, ended, paid for.",
  },
  {
    key: "admin",
    title: "Emails to you",
    blurb: "The daily digest and the alerts that tell you something needs looking at.",
  },
  {
    key: "shell",
    title: "The wrapper",
    blurb: "The header, footer and layout every member email is sent inside. Editing this changes all of them at once.",
  },
  {
    key: "newsletter",
    title: "Newsletter wrapper",
    blurb: "The chrome around a newsletter issue. The stories and adverts inside it are built from the issue itself.",
  },
];

export default async function EmailTemplatesList(props: PageProps<"/console/email-templates">) {
  await requireConsole();
  const sp = await props.searchParams;
  const { data: rows } = await serviceDb().from("email_templates").select("kind, updated_at");
  const edited = new Map((rows ?? []).map((r) => [r.kind, r.updated_at]));

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-xl font-bold text-ink">Email Templates</h1>
      <p className="mt-1 max-w-2xl text-sm text-graphite">
        The wording of every email the website sends. Anything you don&apos;t change keeps the wording it
        shipped with, so leaving a field blank is the same as leaving it alone.
      </p>
      {sp.error && <p className="mt-3 rounded bg-danger/10 p-2 text-sm text-danger">{sp.error}</p>}

      {FAMILIES.map((family) => {
        const kinds = EDITABLE_KINDS.filter((kind) => EMAIL_DEFAULTS[kind as keyof typeof EMAIL_DEFAULTS].family === family.key);
        if (kinds.length === 0) return null;

        return (
          <section key={family.key} className="mt-6">
            <h2 className="font-bold text-ink">{family.title}</h2>
            <p className="mt-0.5 max-w-2xl text-sm text-graphite">{family.blurb}</p>
            <div className="mt-3 overflow-hidden rounded-xl bg-white shadow-sm">
              <ul className="divide-y">
                {kinds.map((kind) => {
                  const def = EMAIL_DEFAULTS[kind as keyof typeof EMAIL_DEFAULTS];
                  const updated = edited.get(kind);
                  return (
                    <li key={kind} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-5 py-3">
                      <Link href={`/console/email-templates/${kind}`} className="font-medium text-ink hover:text-graphite">
                        {def.subject || family.title}
                      </Link>
                      <code className="text-xs text-graphite">{kind}</code>
                      <span className="ml-auto flex items-center gap-2 text-xs text-graphite">
                        {updated ? (
                          <>
                            <Badge tone="brand">Customised</Badge>
                            edited {fmt(updated)}
                          </>
                        ) : (
                          "Original wording"
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </section>
        );
      })}
    </div>
  );
}
