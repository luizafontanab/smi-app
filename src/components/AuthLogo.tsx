import Link from "next/link";
import { Wordmark } from "./Wordmark";

/**
 * The logo, linking home, for the pages outside the site layout (login, reset,
 * unsubscribe). They have no site header, so on a phone this is the only way
 * back to the site (#33). Pinned to h-10 so the header-sized mark can't outgrow
 * the card.
 */
export function AuthLogo() {
  return (
    <Link href="/" aria-label="Sheet Metal Industries home" className="mx-auto flex min-h-11 w-fit items-center [&_img]:h-10">
      <Wordmark tone="light" />
    </Link>
  );
}
