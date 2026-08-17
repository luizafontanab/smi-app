import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { CookieConsent } from "@/components/CookieConsent";
import { SkipLink } from "@/components/SkipLink";
import { currentUser } from "@/lib/auth";

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  return (
    <>
      <SkipLink />
      <SiteHeader user={user} />
      <main id="main" className="flex-1">{children}</main>
      <SiteFooter />
      <CookieConsent />
    </>
  );
}
