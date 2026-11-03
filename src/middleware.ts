import { auth } from "@/auth";
import { type NextRequest, NextResponse } from "next/server";

import { routeCustomerHost } from "@/lib/templates/customer-host-routing";

const isProtectedRoute = (req: NextRequest) => req.nextUrl.pathname.startsWith("/dashboard");

export default auth((req) => {
  if (isProtectedRoute(req) && !req.auth) {
    const newUrl = new URL("/auth/sign-in", req.nextUrl.origin);
    return NextResponse.redirect(newUrl);
  }
  return routeCustomerHost(req);
});

export const config = {
  matcher: [
    "/((?!_next|favicon|^[^/]+$|.*\\.(?:html?|css|js(?!on)|jpe?g|webp|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
