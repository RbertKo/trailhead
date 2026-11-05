"use client";

import { Footprints } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { COPY, type SignInProblem } from "@/lib/trail/copy";
import type { Locale } from "@/lib/trail/request";

const PROBLEMS: Record<number, SignInProblem> = {
  401: "invalid",
  429: "tooMany",
  503: "notConfigured",
};

export function LoginForm() {
  const [locale, setLocale] = useState<Locale>("en");
  const [problem, setProblem] = useState<SignInProblem | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const copy = COPY[locale];

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    setProblem(null);
    setIsSigningIn(true);
    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.get("email"),
          password: form.get("password"),
        }),
      });
      if (response.ok) {
        // Replace, so the back button doesn't return to this page.
        window.location.replace("/");
        return;
      }
      setProblem(PROBLEMS[response.status] ?? "failed");
    } catch {
      setProblem("failed");
    }
    setIsSigningIn(false);
  }

  return (
    <main className="relative flex min-h-dvh items-center justify-center px-5 py-16">
      <Button
        variant="ghost"
        size="xs"
        className="absolute top-3 right-5"
        onClick={() => setLocale(locale === "en" ? "ko" : "en")}
      >
        {COPY[locale === "en" ? "ko" : "en"].languageName}
      </Button>

      <div className="w-full max-w-sm">
        <header className="mb-6">
          <h1 className="flex items-center gap-1.5 text-base font-semibold tracking-tight">
            <Footprints
              className="size-4 translate-y-px text-primary"
              aria-hidden
            />
            Trailhead
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">{copy.tagline}</p>
        </header>

        <form className="grid gap-4" onSubmit={(event) => void signIn(event)}>
          <div className="grid gap-1.5">
            <label htmlFor="email" className="text-sm font-medium">
              {copy.emailLabel}
            </label>
            {/* Not type="email": its format check could block an account the server accepts. */}
            <Input
              id="email"
              name="email"
              type="text"
              inputMode="email"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
              autoFocus
            />
          </div>

          <div className="grid gap-1.5">
            <label htmlFor="password" className="text-sm font-medium">
              {copy.passwordLabel}
            </label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </div>

          {problem && (
            <Alert variant="destructive">
              <AlertDescription>
                {copy.signInProblems[problem]}
              </AlertDescription>
            </Alert>
          )}

          <Button type="submit" size="lg" disabled={isSigningIn}>
            {isSigningIn ? copy.signingIn : copy.signIn}
          </Button>
        </form>
      </div>
    </main>
  );
}
