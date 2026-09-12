import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md rounded-xl border border-line bg-app p-6 text-center">
      <h1 className="text-lg font-semibold">Not found</h1>
      <p className="mt-1.5 text-sm text-ink-2">
        This doesn&rsquo;t exist, or it isn&rsquo;t assigned to you. Editors only see their own
        videos and the open Ready to Edit pool.
      </p>
      <Link
        href="/"
        className="mt-4 inline-block rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hi"
      >
        Back to the dashboard
      </Link>
    </div>
  );
}
