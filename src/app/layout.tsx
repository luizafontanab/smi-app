import type { Metadata } from "next";
import { Geist, Inter_Tight, League_Spartan, Source_Serif_4 } from "next/font/google";
import { cookies } from "next/headers";
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

export const metadata: Metadata = {
  title: {
    default: "Sheet Metal Industries — UK sheet metal, fabrication & welding news",
    template: "%s | Sheet Metal Industries",
  },
  description:
    "The voice of the UK sheet metal, fabrication and welding trade: industry news, member companies, machinery and events.",
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
