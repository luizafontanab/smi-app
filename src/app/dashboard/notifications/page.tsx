import { requireMemberView } from "@/lib/auth";
import { serviceDb } from "@/lib/db/server";
import Link from "next/link";
import { loadEmailTemplates } from "@/lib/email/store";
import { notificationLabel, type NotificationPayload } from "@/lib/email/templates";
import { notificationHref } from "@/lib/notification-links";
import { notificationSlugs, unreadNotificationCount } from "@/lib/notifications";
import { Pagination } from "@/components/Pagination";
import { markAllNotificationsRead, markNotificationRead } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Notifications" };
const PAGE_SIZE = 20;

export default async function NotificationsPage(props: PageProps<"/dashboard/notifications">) {
  const user = await requireMemberView();
  const sp = await props.searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const db = serviceDb();

  const [{ data: notifications, count }, unread] = await Promise.all([
    db.from("notifications").select("id, kind, payload, created_at, read_at", { count: "exact" })
      .eq("member_id", user.memberId)
      .order("created_at", { ascending: false })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1),
    unreadNotificationCount(user.memberId),
  ]);
  const slugs = await notificationSlugs(notifications ?? [], user.memberId);
  // Labels are console-editable, so the feed reads them from the same table
  // the emails do (GAPS A4.10) rather than from a copy in the page.
  const templates = await loadEmailTemplates();
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));
  const qs = (p: number) => (p > 1 ? `/dashboard/notifications?page=${p}` : "/dashboard/notifications");

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-ink">
          Notifications{Boolean(unread) && <span className="ml-2 rounded-full bg-brand px-2 py-0.5 text-xs font-bold text-ink">{unread} unread</span>}
        </h1>
        {Boolean(unread) && (
          <form action={markAllNotificationsRead}>
            <button type="submit" className="text-sm text-graphite underline">Mark all as read</button>
          </form>
        )}
      </div>
      <section className="mt-4 rounded-xl bg-white p-5 shadow-sm">
        {(notifications ?? []).length === 0 && <p className="text-sm text-graphite">No notifications yet.</p>}
        {(notifications ?? []).map((n) => (
          <div key={n.id} className="flex items-center justify-between gap-3 border-t py-3 text-sm first:border-t-0 first:pt-0">
            <div>
              {!n.read_at && <span className="mr-2 inline-block h-2 w-2 rounded-full bg-brand" aria-label="unread" />}
              {/* Linked to whatever it is about (fix list) — the public page
                  when something went live, the member's own editor when it was
                  sent back. Unlinked only when there is genuinely nowhere to go. */}
              {(() => {
                const label = notificationLabel(n.kind, templates);
                const href = notificationHref(n.kind, (n.payload ?? {}) as NotificationPayload, slugs);
                const cls = n.read_at ? "text-graphite" : "font-semibold text-ink";
                return href
                  ? <Link href={href} className={`${cls} underline decoration-graphite/40 underline-offset-2 hover:decoration-ink`}>{label}</Link>
                  : <span className={cls}>{label}</span>;
              })()}
              <span className="ml-2 text-xs text-graphite">{n.created_at.slice(0, 10)}</span>
            </div>
            {!n.read_at && (
              <form action={markNotificationRead}>
                <input type="hidden" name="id" value={n.id} />
                <button type="submit" className="text-xs text-graphite underline hover:text-ink">Mark read</button>
              </form>
            )}
          </div>
        ))}
      </section>
      <Pagination page={page} pages={pages} hrefFor={qs} />
    </div>
  );
}
