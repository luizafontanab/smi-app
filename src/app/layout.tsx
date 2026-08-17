import type { Metadata } from "next";
import { Geist, Inter_Tight, League_Spartan, Source_Serif_4 } from "next/font/google";
import { cookies } from "next/headers";
import { siteUrl } from "@/lib/site-url";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

// Demo-theme fonts (see globals.css): "live" uses League Spartan, "demo" uses
// Inter Tight + Source Serif 4. next/font requires static instantiation here.
const leagueSpartan = League_Spartan({
  variable: "--font-league-spartan",
  subsets: ["latin"],
});

const interTight = Inter_Tight({
  variable: "--font-inter-tight",
  subsets: ["latin"],
});

const sourceSerif = Source_Serif_4({
  variable: "--font-source-serif",
  subsets: ["latin"],
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
  const theme = (await cookies()).get("smi-theme")?.value;
  return (
    <html
      lang="en"
      data-theme={theme === "live" || theme === "demo" ? theme : undefined}
      className={`${geistSans.variable} ${leagueSpartan.variable} ${interTight.variable} ${sourceSerif.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col font-sans">{children}</body>
    </html>
  );
}
