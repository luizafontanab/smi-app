import Link from "next/link";
import { notFound } from "next/navigation";
import { requireConsole } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";
import { must } from "@/lib/db/must";
import { UnsavedChangesGuard } from "@/components/UnsavedChangesGuard";
import { EMAIL_DEFAULTS } from "@/lib/email/defaults";
import {
  EDITABLE_KINDS,
  ctaDestinationFor,
  renderPreview,
  resolveTemplate,
  type EmailTemplateMap,
} from "@/lib/email/templates";
import { resetEmailTemplate, saveEmailTemplate, sendTestEmail } from "../../actions";

export const dynamic = "force-dynamic";

const field = "mt-1 w-full rounded border px-3 py-2";
const code = `${field} font-mono text-xs`;

export default async function EmailTemplateEditor(props: PageProps<"/console/email-templates/[kind]">) {
  const user = await requireConsole();
  const { kind } = await props.params;
  const sp = await props.searchParams;
  if (!EDITABLE_KINDS.includes(kind)) notFound();

  const def = EMAIL_DEFAULTS[kind as keyof typeof EMAIL_DEFAULTS];
  // `kind` is already checked against EDITABLE_KINDS above, and the column is
  // text — no id guard needed here.
  const row = await must(
    serviceDb()
      .from("email_templates")
      .select("subject, label, body_html, body_text, cta_label, updated_at")
      .eq("kind", kind)
      .maybeSingle(),
    "console/email-templates editor",
  );

  // Preview what is actually stored right now, so it reflects the last save
  // rather than whatever is typed in the boxes.
  const overrides: EmailTemplateMap = row ? { [kind]: row } : {};
  const preview = renderPreview(kind, overrides);
  const current = resolveTemplate(kind, overrides);

  const isShell = def.family === "shell" || def.family === "newsletter";
  const isMember = def.family === "member";

  // The heading shows the rendered subject, not the raw one: "SMI — {{total}}
  // item{{total_s}} waiting for you" is not a thing anyone calls an email. The
  // two wrappers have no subject of their own, so they get named instead.
  const heading =
    current.subject.trim()
      ? preview.subject
      : def.family === "newsletter"
        ? "The wrapper around a newsletter issue"
        : "The wrapper around every member email";

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/console/email-templates" className="text-sm text-graphite hover:text-ink">← Email Templates</Link>
      <h1 className="mt-1 text-xl font-bold text-ink">{heading}</h1>
      <p className="mt-1 text-sm text-graphite">
        <code className="text-xs">{kind}</code>
        {row ? " — customised. Reset it below to go back to the original wording." : " — still on its original wording."}
      </p>

      {sp.saved && <p className="mt-3 rounded bg-success/10 p-2 text-sm text-success">Saved. The preview below is the new version.</p>}
      {sp.reset && <p className="mt-3 rounded bg-success/10 p-2 text-sm text-success">Put back to its original wording.</p>}
      {sp.tested && (
        <p className="mt-3 rounded bg-success/10 p-2 text-sm text-success">
          Test sent to {user.email}. If nothing arrives, email isn&apos;t switched on yet — see HUMAN-TODO §1.
        </p>
      )}
      {sp.error && <p className="mt-3 rounded bg-danger/10 p-2 text-sm text-danger">{sp.error}</p>}

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_360px]">
        <form action={saveEmailTemplate} className="space-y-4 rounded-xl bg-white p-5 shadow-sm">
          <UnsavedChangesGuard />
          <input type="hidden" name="kind" value={kind} />

          {!isShell && (
            <div>
              <label htmlFor="subject" className="text-sm font-medium">Subject line</label>
              <input id="subject" name="subject" defaultValue={row?.subject ?? ""} placeholder={def.subject} className={field} />
              <p className="mt-1 text-xs text-graphite">Leave blank to keep: “{def.subject}”</p>
            </div>
          )}

          {isMember && (
            <div>
              <label htmlFor="label" className="text-sm font-medium">In-app wording</label>
              <input id="label" name="label" defaultValue={row?.label ?? ""} placeholder={def.label} className={field} />
              <p className="mt-1 text-xs text-graphite">
                What the member sees in their own notifications list, rather than in the email. Leave blank to
                keep: “{def.label}”
              </p>
            </div>
          )}

          <div>
            <label htmlFor="body_html" className="text-sm font-medium">{isShell ? "Wrapper HTML" : "Body (HTML)"}</label>
            <textarea id="body_html" name="body_html" rows={isShell ? 22 : 10} defaultValue={row?.body_html ?? ""} placeholder={def.bodyHtml} className={code} />
            <p className="mt-1 text-xs text-graphite">
              {def.family === "admin"
                ? "This email goes to you as plain text. Leave this blank and it stays that way — put HTML here only if you'd rather it looked like the member emails."
                : `This is the HTML that goes out${def.family === "newsletter" ? " to subscribers" : " to the member"}. Leave it blank to keep the original.`}{" "}
              Email clients are fussy: stick to tables and inline styles, and check the preview before you rely on it.
            </p>
          </div>

          <div>
            <label htmlFor="body_text" className="text-sm font-medium">Body (plain text)</label>
            <textarea id="body_text" name="body_text" rows={isShell ? 3 : 6} defaultValue={row?.body_text ?? ""} placeholder={def.bodyText} className={code} />
            <p className="mt-1 text-xs text-graphite">
              Sent alongside the HTML, for anyone whose email won&apos;t show it. Both versions always go out.
            </p>
          </div>

          {def.ctaLabel !== undefined && (
            <div>
              <label htmlFor="cta_label" className="text-sm font-medium">Button wording</label>
              <input id="cta_label" name="cta_label" defaultValue={row?.cta_label ?? ""} placeholder={def.ctaLabel} className={field} />
              <p className="mt-1 text-xs text-graphite">
                Where the button goes is worked out automatically and can&apos;t be changed here — for this email
                it&apos;s <code className="break-all">{ctaDestinationFor(kind)}</code>. If the details it needs are
                missing, the button falls back to the member area and says so.
              </p>
            </div>
          )}

          <button className="rounded bg-ink px-5 py-2.5 text-white">Save</button>
        </form>

        <div className="space-y-4">
          <section className="rounded-xl bg-white p-5 shadow-sm">
            <h2 className="font-bold text-ink">Placeholders</h2>
            {def.tokens.length === 0 ? (
              <p className="mt-2 text-sm text-graphite">This email has no placeholders — the wording is the same every time.</p>
            ) : (
              <>
                <p className="mt-1 text-xs text-graphite">Type these anywhere in a field and they&apos;re filled in when the email is sent.</p>
                <dl className="mt-3 space-y-3">
                  {def.tokens.map((t) => (
                    <div key={t.token}>
                      <dt><code className="rounded bg-shade px-1.5 py-0.5 text-xs">{`{{${t.token}}}`}</code></dt>
                      <dd className="mt-1 text-xs text-graphite">{t.description}</dd>
                    </div>
                  ))}
                </dl>
              </>
            )}
          </section>

          <form action={sendTestEmail} className="rounded-xl bg-white p-5 shadow-sm">
            <input type="hidden" name="kind" value={kind} />
            <h2 className="font-bold text-ink">Send yourself a copy</h2>
            <p className="mt-1 text-xs text-graphite">
              Sends this email, as last saved, to {user.email}. It only ever goes to you.
            </p>
            <button className="mt-3 rounded border px-4 py-2 text-sm text-ink">Send a test</button>
          </form>
        </div>
      </div>

      <section className="mt-4 rounded-xl bg-white p-5 shadow-sm">
        <h2 className="font-bold text-ink">Preview</h2>
        <p className="mt-1 text-xs text-graphite">
          As last saved, with example details filled in. Save to see a change here.
        </p>
        <p className="mt-3 text-sm"><span className="text-graphite">Subject:</span> <strong>{preview.subject}</strong></p>
        {/*
          sandbox="" switches on every restriction, so a <script> typed into a
          template can't reach the console's origin or its service-role session.
          Email clients wouldn't run it either — but this page would.
        */}
        <iframe
          srcDoc={preview.html}
          sandbox=""
          title="Email preview"
          className="mt-3 h-[520px] w-full rounded border bg-white"
        />
        <details className="mt-3">
          <summary className="cursor-pointer text-sm text-graphite">Plain-text version</summary>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded bg-shade p-3 text-xs text-ink">{preview.text}</pre>
        </details>
      </section>

      {row && (
        <form action={resetEmailTemplate} className="mt-4 rounded-xl border border-danger/30 bg-white p-5 shadow-sm">
          <input type="hidden" name="kind" value={kind} />
          <h2 className="font-bold text-ink">Put back to the original wording</h2>
          <p className="mt-1 text-sm text-graphite">
            Throws away your changes to this email and goes back to the wording it shipped with. Nothing else is affected.
          </p>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input type="checkbox" name="confirm" value="1" required />
            Yes, discard my changes to this email
          </label>
          <button className="mt-3 rounded border border-danger/30 px-4 py-2 text-sm text-danger">Reset</button>
        </form>
      )}
    </div>
  );
}
