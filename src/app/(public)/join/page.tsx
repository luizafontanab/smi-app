import { JoinView } from "@/components/design-option";

export const metadata = {
  title: "Become a Member",
  description: "Join Sheet Metal Industries for £40/month — a company page, news coverage, and a direct line to the UK sheet metal trade.",
  alternates: { canonical: "/join" },
};

// Rendered through the design-option hook point, never directly (#69).
export default function JoinPage() {
  return <JoinView />;
}
