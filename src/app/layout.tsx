import type { Metadata, Viewport } from "next";
import { League_Spartan, Source_Sans_3 } from "next/font/google";
import { DevTaskLauncher } from "@/components/dev-task/DevTaskLauncher";
import { ThemeLauncher } from "@/components/ThemeLauncher";
import { OG_BASE, SITE_DESCRIPTION, SITE_NAME } from "@/lib/seo";
import { siteUrl } from "@/lib/site-url";
import { siteVariant } from "@/lib/variant";
import "./globals.css";

// The brand faces, shared by both designs. next/font requires static
// instantiation here. League Spartan is the display/heading voice; Source Sans 3
// carries body and UI text (geometric Spartan is ambiguous at reading sizes —
// I/l/1 — and has no tabular figures, which the console's stats need). The
// wordmark is the supplied SVG artwork (components/Wordmark.tsx), not a font.
const leagueSpartan = League_Spartan({
  variable: "--font-league-spartan",
  subsets: ["latin"],
});

const sourceSans = Source_Sans_3({
  variable: "--font-source-sans",
  subsets: ["latin"],
  // Editorial bodies out of WordPress carry real <em>; without the italic axis
  // the browser slants the roman instead.
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  // Without metadataBase, Next resolves relative OG/Twitter image URLs against
  // localhost and warns at build. Every page-level openGraph.url below is
  // relative and resolved from here.
  metadataBase: new URL(siteUrl()),
  title: {
    default: `${SITE_NAME} — UK sheet metal, fabrication & welding news`,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  openGraph: {
    ...OG_BASE,
    type: "website",
    title: `${SITE_NAME} — UK sheet metal, fabrication & welding news`,
    description: SITE_DESCRIPTION,
  },
  twitter: { card: "summary_large_image", title: SITE_NAME, description: SITE_DESCRIPTION },
};

export const viewport: Viewport = {
  // width/initial-scale match what Next injects by default — declared so the
  // rest is explicit: the chrome colour paints the browser UI on mobile, and
  // colorScheme stops iOS/Android auto-darkening a light-designed page.
  width: "device-width",
  initialScale: 1,
  themeColor: "#0b0d10",
  colorScheme: "light",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Stamped for both designs, forge included: a symmetric attribute gives grid a
  // clean CSS hook and a clean test handle. Must come from siteVariant(), the
  // same resolution the public layout and pages use — reading the cookie here
  // directly would stamp forge on <html> while the page rendered the site-wide
  // grid default (GAPS A8.2).
  const theme = await siteVariant();
  return (
    <html
      lang="en"
      data-theme={theme}
      className={`${leagueSpartan.variable} ${sourceSans.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col font-sans">
        {children}
        <DevTaskLauncher />
        {/* After DevTaskLauncher so the Feedback button keeps its tab position;
            both are admin-only and render nothing for everyone else. */}
        <ThemeLauncher />
      </body>
    </html>
  );
}
