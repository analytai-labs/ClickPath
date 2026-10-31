import { describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";

import { routeCustomerHost } from "./customer-host-routing";

const ID = "5f8d0d55b54764421b7156c9";

/** Where the middleware sends `path` requested on `host`, or null if it is not rewritten. */
function rewriteFor(host: string, path: string): string | null {
  const request = new NextRequest(`http://localhost:3000${path}`, { headers: { host } });
  const target = routeCustomerHost(request)?.headers.get("x-middleware-rewrite");
  return target ? new URL(target).pathname + new URL(target).search : null;
}

describe("customer host routing", () => {
  test("/productdetails/<id> rewrites to the host page route with its prefix", () => {
    expect(rewriteFor("old-domain.com", `/productdetails/${ID}`)).toBe(
      `/p-host/old-domain.com/productdetails/${ID}`,
    );
  });

  test("a trailing slash still resolves", () => {
    expect(rewriteFor("old-domain.com", `/productdetails/${ID}/`)).toBe(
      `/p-host/old-domain.com/productdetails/${ID}`,
    );
  });

  test("an upper-case id is lower-cased", () => {
    expect(rewriteFor("old-domain.com", `/productdetails/${ID.toUpperCase()}`)).toBe(
      `/p-host/old-domain.com/productdetails/${ID}`,
    );
  });

  test("the query string is ignored", () => {
    expect(rewriteFor("old-domain.com", `/productdetails/${ID}?shem=aimgspe`)).toBe(
      `/p-host/old-domain.com/productdetails/${ID}`,
    );
  });

  test("/p/<slug> and the domain root keep working", () => {
    expect(rewriteFor("brand.com", "/p/spring")).toBe("/p-host/brand.com/p/spring");
    expect(rewriteFor("brand.com", "/")).toBe("/p-host/brand.com");
  });

  test("the host header's port and case do not matter", () => {
    expect(rewriteFor("Old-Domain.com:443", `/productdetails/${ID}`)).toBe(
      `/p-host/old-domain.com/productdetails/${ID}`,
    );
  });

  test("an unknown prefix, extra segments or a bare prefix are not rewritten", () => {
    expect(rewriteFor("old-domain.com", `/product/${ID}`)).toBeNull();
    expect(rewriteFor("old-domain.com", `/productdetails/${ID}/extra`)).toBeNull();
    expect(rewriteFor("old-domain.com", "/productdetails")).toBeNull();
    expect(rewriteFor("old-domain.com", "/l/abc")).toBeNull();
  });

  test("platform hosts are not rewritten", () => {
    for (const host of ["clickpath.analytai.in", "clk.path", "acme.clk.path", "localhost:3000"]) {
      expect(rewriteFor(host, `/productdetails/${ID}`)).toBeNull();
      expect(rewriteFor(host, "/p/spring")).toBeNull();
    }
  });
});
