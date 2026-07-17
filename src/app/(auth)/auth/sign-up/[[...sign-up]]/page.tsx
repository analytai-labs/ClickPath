"use client";

import { Button } from "@/components/ui/button";
import { IconBrandGithub, IconBrandGoogle, IconMail } from "@tabler/icons-react";
import { signIn } from "next-auth/react";
import { Link } from "next-view-transitions";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

function SignUpForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlError = searchParams.get("error");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [isMagicLinkSent, setIsMagicLinkSent] = useState(false);

  useEffect(() => {
    if (urlError === "OAuthAccountNotLinked") {
      setError("To confirm your identity, sign in with the same account you used originally.");
    } else if (urlError) {
      setError("An error occurred during sign up. Please try again.");
    }
  }, [urlError]);

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return setError("Please enter your email");
    setIsLoading(true);
    setError("");

    const result = await signIn("resend", {
      email,
      redirect: false,
      callbackUrl: "/dashboard",
    });

    if (result?.error) {
      setError("Failed to send magic link");
    } else {
      setIsMagicLinkSent(true);
    }
    setIsLoading(false);
  };

  const handlePasswordSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return setError("Please enter email and password");
    setIsLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.message || "Something went wrong");
        setIsLoading(false);
        return;
      }

      // Instead of automatically signing in, prompt user to verify email
      setIsMagicLinkSent(true);
    } catch (err) {
      setError("Failed to register. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex w-full max-w-md flex-col items-center justify-center space-y-6 rounded-[24px] border border-[var(--warm-line)] bg-[var(--warm-paper)] p-8 shadow-xl">
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--warm-ink)]">
          Create an account
        </h1>
        <p className="mt-2 text-sm text-[var(--warm-mute-soft)]">Sign up with Email, Google, or GitHub</p>
      </div>

      <div className="w-full flex flex-col space-y-4">
        {error && <p className="text-red-500 text-sm text-center">{error}</p>}
        {isMagicLinkSent && (
          <p className="text-green-600 text-sm text-center">Check your email for a verification link!</p>
        )}

        <form onSubmit={handlePasswordSignUp} className="flex flex-col space-y-3">
          <input
            type="text"
            placeholder="Name (optional)"
            className="h-11 w-full rounded-xl border border-[var(--warm-line)] bg-[var(--warm-paper)] px-3.5 py-2 text-sm text-[var(--warm-ink)] placeholder-[var(--warm-mute-soft)] transition-all focus:border-[var(--warm-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--warm-accent)]/20"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={isLoading}
          />
          <input
            type="email"
            placeholder="Email address"
            className="h-11 w-full rounded-xl border border-[var(--warm-line)] bg-[var(--warm-paper)] px-3.5 py-2 text-sm text-[var(--warm-ink)] placeholder-[var(--warm-mute-soft)] transition-all focus:border-[var(--warm-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--warm-accent)]/20"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={isLoading}
          />
          <input
            type="password"
            placeholder="Password (optional for magic link)"
            className="h-11 w-full rounded-xl border border-[var(--warm-line)] bg-[var(--warm-paper)] px-3.5 py-2 text-sm text-[var(--warm-ink)] placeholder-[var(--warm-mute-soft)] transition-all focus:border-[var(--warm-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--warm-accent)]/20"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={isLoading}
          />
          <div className="flex gap-2">
            <Button
              type="submit"
              className="h-11 flex-1 border-none bg-[var(--warm-accent)] text-[var(--warm-accent-ink)] hover:bg-[var(--warm-accent-deep)]"
              disabled={isLoading || !password}
            >
              Sign up with Password
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-11 flex-1 border-[var(--warm-line)] bg-[var(--warm-paper)] text-[var(--warm-ink)] hover:bg-[var(--warm-line-soft)]"
              onClick={handleMagicLink}
              disabled={isLoading || !email}
            >
              <IconMail className="mr-2 h-4 w-4" />
              Sign up via Link
            </Button>
          </div>
        </form>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t border-[var(--warm-line)]" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-[var(--warm-paper)] px-2 text-[var(--warm-mute-soft)]">Or continue with</span>
          </div>
        </div>

        <Button
          variant="outline"
          className="h-11 w-full border-[var(--warm-line)] bg-[var(--warm-paper)] text-[var(--warm-ink)] hover:bg-[var(--warm-line-soft)]"
          onClick={() => signIn("google", { callbackUrl: "/dashboard" })}
        >
          <IconBrandGoogle className="mr-2 h-5 w-5" />
          Google
        </Button>
        <Button
          variant="outline"
          className="h-11 w-full border-[var(--warm-line)] bg-[var(--warm-paper)] text-[var(--warm-ink)] hover:bg-[var(--warm-line-soft)]"
          onClick={() => signIn("github", { callbackUrl: "/dashboard" })}
        >
          <IconBrandGithub className="mr-2 h-5 w-5" />
          GitHub
        </Button>

        <p className="text-center text-sm text-[var(--warm-mute-soft)]">
          Already have an account?{" "}
          <Link href="/auth/sign-in" className="text-[var(--warm-ink)] hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function SignUpPage() {
  return (
    <Suspense fallback={<div className="text-center text-sm text-neutral-500">Loading...</div>}>
      <SignUpForm />
    </Suspense>
  );
}
