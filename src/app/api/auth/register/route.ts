import { prisma } from "@/server/db";
import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";
import crypto from "crypto";
import { resend } from "@/server/lib/notifications/resend-client";

const registerSchema = z.object({
  email: z
    .string()
    .email()
    .max(255)
    .transform((e) => e.toLowerCase().trim()),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters long")
    .max(72, "Password must be at most 72 characters long"),
  name: z.string().max(255).optional(),
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const result = registerSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { message: "Invalid input", errors: result.error.flatten() },
        { status: 400 },
      );
    }

    const { email, password, name } = result.data;

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return NextResponse.json({ message: "User with this email already exists" }, { status: 400 });
    }

    // Hash password & Generate Token
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const token = crypto.randomBytes(32).toString("hex");

    // Send Verification Email FIRST to avoid dead accounts on failure
    const origin = process.env.NEXT_PUBLIC_APP_URL || "https://clickpath.analytai.in";
    const verifyLink = `${origin}/auth/verify?token=${token}&email=${encodeURIComponent(email)}`;

    if (resend) {
      await resend.emails.send({
        from: process.env.EMAIL_FROM || "onboarding@resend.dev",
        to: email,
        subject: "Verify your email address",
        html: `
          <div style="font-family: sans-serif; max-w-md: 600px; margin: 0 auto;">
            <h1>Verify your email address</h1>
            <p>Hi ${name || 'there'},</p>
            <p>Please click the link below to verify your email address and complete your registration:</p>
            <a href="${verifyLink}" style="display: inline-block; padding: 12px 24px; background-color: #7c3aed; color: white; text-decoration: none; border-radius: 8px; margin-top: 16px;">Verify Email</a>
            <p style="margin-top: 24px; font-size: 14px; color: #666;">Or copy and paste this link in your browser: <br/>${verifyLink}</p>
          </div>
        `,
      });
    }

    // If email succeeds (or is disabled), create user and token
    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
      },
    });

    await prisma.verificationToken.create({
      data: {
        identifier: email,
        token,
        expires: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      },
    });

    // Don't return the password
    return NextResponse.json(
      {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      return NextResponse.json({ message: "User with this email already exists" }, { status: 400 });
    }
    console.error("Registration error:", error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
