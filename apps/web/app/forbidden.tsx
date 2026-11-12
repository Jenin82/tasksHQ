import Link from "next/link";

export default function Forbidden() {
  return (
    <main className="grid min-h-screen place-items-center px-6">
      <div className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-subtle">
        <p className="stutter numeral">403</p>
        <h1 className="mt-3 text-2xl">
          Not your call
        </h1>
        <p className="mt-2 text-base text-muted-foreground">
          Your role in this organization does not allow that. An owner or an
          admin can do it for you.
        </p>
        <Link href="/" className="stutter mt-8 inline-block hover:text-foreground">
          Back
        </Link>
      </div>
    </main>
  );
}
