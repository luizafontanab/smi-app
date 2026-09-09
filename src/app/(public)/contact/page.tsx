import { ContactForm } from "@/components/ContactForm";

export const metadata = {
  title: "Contact",
  description: "Get in touch with Sheet Metal Industries — news tips, membership questions and advertising enquiries.",
  alternates: { canonical: "/contact" },
};

export default function ContactPage() {
  return (
    <div className="mx-auto max-w-xl px-4">
      <h1 className="mt-6 text-2xl font-bold text-ink">Contact us</h1>
      <p className="mt-2 text-sm text-graphite">
        The editorial department can be contacted directly via email: <a href="mailto:editorial@sheetmetalindustries.com" className="text-graphite underline">editorial@sheetmetalindustries.com</a>
      </p>
      <p className="mt-2 text-sm text-graphite">
        The sales department can be contacted directly via email: <a href="mailto:sales@sheetmetalindustries.com" className="text-graphite underline">sales@sheetmetalindustries.com</a> or call <a href="tel:+441926298292" className="text-graphite underline">01926 298 292</a>
      </p>
      <div className="mt-6 rounded-lg bg-white p-6 shadow-sm">
        <ContactForm kind="contact" />
      </div>
      <div className="my-10" />
    </div>
  );
}
