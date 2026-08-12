import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { AccountForm } from "./AccountForm";

export const metadata = { title: "Create your account" };

export default async function JoinAccountPage() {
  const user = await currentUser();
  if (user?.role === "member") redirect("/member");
  return (
    <div className="mx-auto max-w-md px-4">
      <div className="mt-10 rounded-xl bg-white p-8 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-amber">Step 1 of 4</p>
        <h1 className="mt-1 text-xl font-bold text-navy">Create your account</h1>
        <p className="mt-1 text-sm text-gray-500">
          Payment (£40/month) is the next step — card details never touch SMI&apos;s servers.
        </p>
        <AccountForm />
      </div>
    </div>
  );
}
