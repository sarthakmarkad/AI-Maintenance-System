import Link from "next/link";
export default function NotFound() {
  return (
    <main className="state-card">
      <h1>Page not found</h1>
      <Link href="/machines">Return to asset registry</Link>
    </main>
  );
}
