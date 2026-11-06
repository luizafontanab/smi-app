import Link from "next/link";
import { Wordmark } from "./Wordmark";

/**
 * The logo, linking home, for the pages outside the site layout (login, reset,
 * unsubscribe). They have no site header, so on a phone this is the only way
 * back to the site (#33). From sm up the wide mark is pinned to h-10 so it can't
 * outgrow the card; on a phone the stacked lockup keeps the headers' h-15 (~175px
 * wide) — at h-10 it shrank to ~116px and its tagline was unreadable.
 */
export function AuthLogo() {
  return (
    <Link href="/" aria-label="Sheet Metal Industries home" className="mx-auto flex min-h-11 w-fit items-center sm:[&_img]:h-10">
      <Wordmark tone="light" />
    </Link>
  );
}
