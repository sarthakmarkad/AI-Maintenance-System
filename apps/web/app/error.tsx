"use client";
import { Button } from "@/components/ui/button";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="state-card">
      <h1>Something interrupted this page</h1>
      <p>Please reload the workspace and try again.</p>
      <Button onClick={reset}>Try again</Button>
    </main>
  );
}
