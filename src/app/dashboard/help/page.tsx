import { requireMemberView } from "@/lib/auth";
import { sendMemberMessage } from "../actions";
import { RequiredMark } from "@/components/RequiredMark";

export const dynamic = "force-dynamic";
export const metadata = { title: "Help" };

export default async function MemberHelpPage(props: PageProps<"/dashboard/help">) {
  await requireMemberView();
  const sp = await props.searchParams;
  return (
    <div className="max-w-2xl lg:mx-auto">
      <h1 className="mt-1 text-xl font-bold text-ink">Help</h1>
      <p className="mt-1 text-sm text-graphite">
        Stuck, or need something changed? Send a message and it lands straight with SMI — we reply to your login email.
      </p>
      {sp.sent === "1" && (
        <p className="mt-3 rounded bg-success/10 p-3 text-sm text-success">Message sent — we&apos;ll come back to you shortly.</p>
      )}
      {typeof sp.error === "string" && (
        <p className="mt-3 rounded bg-danger/10 p-2 text-sm text-danger">{sp.error}</p>
      )}
      <form action={sendMemberMessage} className="mt-5 space-y-4 rounded-xl bg-white p-6 shadow-sm">
        <div>
          <label htmlFor="help-message" className="text-sm font-medium">Message<RequiredMark /></label>
          <textarea id="help-message" name="message" required rows={6} className="mt-1 w-full rounded border px-3 py-2" />
        </div>
        <button className="rounded bg-ink px-5 py-2.5 text-white">Send</button>
      </form>
    </div>
  );
}
