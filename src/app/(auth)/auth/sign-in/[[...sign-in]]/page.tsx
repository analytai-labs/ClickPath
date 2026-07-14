"use client";

import { Button } from "@/components/ui/button";
import { IconBrandGithub, IconBrandGoogle, IconMail } from "@tabler/icons-react";
import { signIn } from "next-auth/react";
import { Link } from "next-view-transitions";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

function SignInForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlError = searchParams.get("error");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [isMagicLinkSent, setIsMagicLinkSent] = useState(false);

  useEffect(() => {
    if (urlError === "OAuthAccountNotLinked") {
      setError("To confirm your identity, sign in with the same account you used originally.");
    } else if (urlError) {
      setError("An error occurred during sign in. Please try again.");
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

  const handlePasswordSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return setError("Please enter email and password");
    setIsLoading(true);
    setError("");

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
      callbackUrl: "/dashboard",
    });

    if (result?.error) {
      setError("Invalid email or password");
      setIsLoading(false);
    } else {
      router.push("/dashboard");
      router.refresh();
    }
  };

  return (
    <div className="flex flex-col items-center justify-center space-y-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">Welcome back</h1>
        <p className="mt-2 text-sm text-neutral-600">Sign in to your account to continue</p>
      </div>

      <div className="w-full flex flex-col space-y-4">
        {error && <p className="text-red-500 text-sm text-center">{error}</p>}
        {isMagicLinkSent && (
          <p className="text-green-600 text-sm text-center">Check your email for a login link!</p>
        )}

        <form onSubmit={handlePasswordSignIn} className="flex flex-col space-y-3">
          <input
            type="email"
            placeholder="Email address"
            className="h-11 rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={isLoading}
          />
          <input
            type="password"
            placeholder="Password (optional for magic link)"
            className="h-11 rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={isLoading}
          />
          <div className="flex gap-2">
            <Button
              type="submit"
              className="h-11 flex-1 bg-neutral-900 text-white hover:bg-neutral-800"
              disabled={isLoading || !password}
            >
              Sign in with Password
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-11 flex-1"
              onClick={handleMagicLink}
              disabled={isLoading || !email}
            >
              <IconMail className="mr-2 h-4 w-4" />
              Send Magic Link
            </Button>
          </div>
        </form>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t border-neutral-200" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-white px-2 text-neutral-500">Or continue with</span>
          </div>
        </div>

        <Button
          variant="outline"
          className="h-11 w-full bg-white text-neutral-900 hover:bg-neutral-50"
          onClick={() => signIn("google", { callbackUrl: "/dashboard" })}
        >
          <IconBrandGoogle className="mr-2 h-5 w-5" />
          Google
        </Button>
        <Button
          variant="outline"
          className="h-11 w-full bg-white text-neutral-900 hover:bg-neutral-50"
          onClick={() => signIn("github", { callbackUrl: "/dashboard" })}
        >
          <IconBrandGithub className="mr-2 h-5 w-5" />
          GitHub
        </Button>

        <p className="text-center text-sm text-neutral-500">
          Don't have an account?{" "}
          <Link href="/auth/sign-up" className="text-neutral-900 hover:underline">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={<div className="text-center text-sm text-neutral-500">Loading...</div>}>
      <SignInForm />
    </Suspense>
  );
}
