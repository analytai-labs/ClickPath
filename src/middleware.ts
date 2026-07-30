import { auth } from "@/auth";
import { type NextRequest, NextResponse } from "next/server";

import { extractPlatformSubdomain, isPlatformDomain } from "@/lib/constants/domains";

const isProtectedRoute = (req: NextRequest) => req.nextUrl.pathname.startsWith("/dashboard");

/** Routes a customer's own domain to the pages it is allowed to serve. */
async function routeCustomerHost(request: NextRequest) {
  if (isProtectedRoute(request)) {
    return;
  }

  const { pathname, host } = new URL(request.url);

  // Take the host from the request headers, not from `request.url` — behind a
  // proxy (and for `next start`) the URL carries the listening address, which
  // would silently disable all customer-domain routing.
  const requestHost =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? host;
  const bareHost = (requestHost.split(":")[0] ?? requestHost).toLowerCase();
  // A host that isn't ours: it's a customer's own verified domain (or an
  // impostor — the routes below verify ownership before serving anything).
  const isCustomerHost =
    !!bareHost &&
    !bareHost.includes("localhost") &&
    !bareHost.endsWith(".vercel.app") && // preview/deploy URLs keep the marketing root
    !isPlatformDomain(bareHost) &&
    extractPlatformSubdomain(bareHost) === null;

  if (isCustomerHost) {
    // A verified custom domain serves its owner's page at the domain root.
    // Short links live at /l/<alias>, which is a real route and needs no rewrite.
    if (pathname === "/") {
      return NextResponse.rewrite(new URL(`/p-host/${encodeURIComponent(bareHost)}`, request.url));
    }

    // ...and serves every template page in that workspace at /p/<slug>, so the
    // pages and any printed QR codes do not depend on the platform domain.
    const templateSlug = pathname.startsWith("/p/") ? pathname.slice(3) : null;
    if (templateSlug && !templateSlug.includes("/")) {
      return NextResponse.rewrite(
        new URL(
          `/p-host/${encodeURIComponent(bareHost)}/p/${encodeURIComponent(templateSlug)}`,
          request.url,
        ),
      );
    }
  }

  return NextResponse.next();
}

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
