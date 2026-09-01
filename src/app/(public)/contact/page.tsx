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
      <p className="mt-2 text-sm text-gray-600">Story tips, membership questions, anything else — it lands straight with the editor.</p>
      <div className="mt-6 rounded-lg bg-white p-6 shadow-sm">
        <ContactForm kind="contact" />
      </div>
      <div className="my-10" />
    </div>
  );
}
