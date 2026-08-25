import type { Metadata } from "next";
import { Allerta_Stencil, League_Spartan } from "next/font/google";
import { cookies } from "next/headers";
import { siteUrl } from "@/lib/site-url";
import "./globals.css";

// The client's brand faces, shared by both designs. next/font requires static
// instantiation here. League Spartan is the body and heading face; the logo
// face is applied only to the wordmark in components/SiteHeader.tsx.
const leagueSpartan = League_Spartan({
  variable: "--font-league-spartan",
  subsets: ["latin"],
});

const allertaStencil = Allerta_Stencil({
  variable: "--font-allerta-stencil",
  subsets: ["latin"],
  weight: "400", // single-weight family, so next/font requires this explicitly
});

const SITE_NAME = "Sheet Metal Industries";
const DESCRIPTION =
  "The voice of the UK sheet metal, fabrication and welding trade: industry news, member companies, machinery and events.";

export const metadata: Metadata = {
  // Without metadataBase, Next resolves relative OG/Twitter image URLs against
  // localhost and warns at build. Every page-level openGraph.url below is
  // relative and resolved from here.
  metadataBase: new URL(siteUrl()),
  title: {
    default: `${SITE_NAME} — UK sheet metal, fabrication & welding news`,
    template: `%s | ${SITE_NAME}`,
  },
  description: DESCRIPTION,
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    locale: "en_GB",
    title: `${SITE_NAME} — UK sheet metal, fabrication & welding news`,
    description: DESCRIPTION,
  },
  twitter: { card: "summary_large_image", title: SITE_NAME, description: DESCRIPTION },
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Stamped for both designs, forge included: a symmetric attribute gives grid a
  // clean CSS hook and a clean test handle. Anything unrecognised — including the
  // retired "live"/"demo" still in returning browsers' cookie jars — is forge.
  const theme = (await cookies()).get("smi-theme")?.value === "grid" ? "grid" : "forge";
  return (
    <html
      lang="en"
      data-theme={theme}
      className={`${leagueSpartan.variable} ${allertaStencil.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col font-sans">{children}</body>
    </html>
  );
}
