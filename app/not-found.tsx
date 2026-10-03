import Link from "next/link";

// Shown for any unknown URL. Static, no database, so it renders during an
// outage too.
export default function NotFound() {
  return (
    <main className="mx-auto max-w-md px-4 py-24 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="mt-3 leading-7 text-neutral-600 dark:text-neutral-300">
        There&apos;s nothing at this address.
      </p>
      <p className="mt-6">
        <Link href="/" className="text-sm font-medium underline">
          Go to rmdig.ai
        </Link>
      </p>
    </main>
  );
}
