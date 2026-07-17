import { prisma } from "@/server/db";
import { Link } from "next-view-transitions";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { IconCheck, IconX } from "@tabler/icons-react";

export default async function VerifyPage(props: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const searchParams = await props.searchParams;
  const token = typeof searchParams.token === "string" ? searchParams.token : undefined;
  const email = typeof searchParams.email === "string" ? searchParams.email : undefined;

  if (!token || !email) {
    redirect("/auth/sign-in");
  }

  let isSuccess = false;
  let message = "";

  try {
    const verificationToken = await prisma.verificationToken.findUnique({
      where: {
        identifier_token: {
          identifier: email,
          token,
        },
      },
    });

    if (!verificationToken) {
      message = "Invalid or missing verification token.";
    } else if (verificationToken.expires < new Date()) {
      message = "Verification token has expired.";
      // Cleanup expired token
      await prisma.verificationToken.delete({
        where: {
          identifier_token: {
            identifier: email,
            token,
          },
        },
      });
    } else {
      // Mark user as verified and cleanup token in a transaction
      await prisma.$transaction([
        prisma.user.update({
          where: { email },
          data: { emailVerified: new Date() },
        }),
        prisma.verificationToken.delete({
          where: {
            identifier_token: {
              identifier: email,
              token,
            },
          },
        }),
      ]);

      isSuccess = true;
      message = "Your email has been successfully verified! You can now sign in.";
    }
  } catch (e) {
    console.error("Verification error:", e);
    message = "An error occurred during verification. Please try again.";
  }

  return (
    <div className="flex w-full max-w-md flex-col items-center justify-center space-y-6 rounded-[24px] border border-[var(--warm-line)] bg-[var(--warm-paper)] p-8 shadow-xl">
      <div className="flex flex-col items-center space-y-4 text-center">
        {isSuccess ? (
          <div className="rounded-full bg-green-100 p-4 text-green-600">
            <IconCheck size={32} />
          </div>
        ) : (
          <div className="rounded-full bg-red-100 p-4 text-red-600">
            <IconX size={32} />
          </div>
        )}
        <h1 className="text-2xl font-semibold tracking-tight text-[var(--warm-ink)]">
          {isSuccess ? "Verified" : "Verification Failed"}
        </h1>
        <p className="mt-2 text-sm text-[var(--warm-mute-soft)]">{message}</p>
      </div>

      <div className="w-full">
        <Link href="/auth/sign-in" className="w-full">
          <Button className="w-full bg-[var(--warm-accent)] text-white hover:bg-[var(--warm-accent)]/90">
            Continue to Sign In
          </Button>
        </Link>
      </div>
    </div>
  );
}
