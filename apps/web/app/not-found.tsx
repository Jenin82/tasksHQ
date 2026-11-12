import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center px-6">
      <div className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-subtle">
        <p className="stutter numeral">404</p>
        <h1 className="mt-3 text-2xl">
          Nothing here
        </h1>
        <p className="mt-2 text-base text-muted-foreground">
          That page does not exist, or it belongs to an organization you are not
          a member of.
        </p>
        <Link href="/" className="stutter mt-8 inline-block hover:text-foreground">
          Back
        </Link>
      </div>
    </main>
  );
}
