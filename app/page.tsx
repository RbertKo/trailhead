import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-start justify-center gap-4 px-4 py-10">
      <h1 className="text-xl font-semibold">Project foundation</h1>
      <p className="text-sm text-muted-foreground">
        The project topic has not been chosen yet. This page is a placeholder
        for the product.
      </p>
      <Button asChild variant="outline">
        <Link href="/playground">Open the API playground</Link>
      </Button>
    </main>
  );
}
