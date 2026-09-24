import { requireUser } from "@/lib/auth";
import { ChangePasswordForm } from "@/components/ChangePasswordForm";

/** Everyone — any role — changes their own password here. */
export default async function AccountPage() {
  const me = await requireUser();
  return (
    <div className="max-w-md space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Your account</h1>
        <p className="text-sm text-ink-2">Signed in as {me.email}.</p>
      </div>
      <ChangePasswordForm />
    </div>
  );
}
