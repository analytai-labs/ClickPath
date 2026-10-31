import { beforeEach, describe, expect, mock, test } from "bun:test";

// An in-memory stand-in for the few Prisma calls these services make. `where`
// clauses are matched by plain equality, which is all these paths use.
type Row = Record<string, unknown> & { id: number };

function createTable(name: string, unique: string[] = []) {
  let rows: Row[] = [];
  let nextId = 1;
  const matches = (row: Row, where: Record<string, unknown> = {}) =>
    Object.entries(where).every(([key, value]) => row[key] === value);
  const sorted = (list: Row[]) =>
    [...list].sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0) || a.id - b.id);

  return {
    reset(seed: Omit<Row, "id">[] = []) {
      rows = [];
      nextId = 1;
      for (const row of seed) rows.push({ ...row, id: nextId++ });
    },
    all: () => rows,
    findFirst: async ({ where }: { where?: Record<string, unknown> }) =>
      rows.find((r) => matches(r, where)) ?? null,
    findUnique: async ({ where }: { where: Record<string, unknown> }) =>
      rows.find((r) => matches(r, where)) ?? null,
    findMany: async ({ where }: { where?: Record<string, unknown> }) =>
      sorted(rows.filter((r) => matches(r, where))),
    count: async ({ where }: { where?: Record<string, unknown> }) =>
      rows.filter((r) => matches(r, where)).length,
    create: async ({ data }: { data: Record<string, unknown> }) => {
      for (const key of unique) {
        if (data[key] != null && rows.some((r) => r[key] === data[key])) {
          throw Object.assign(new Error(`Unique constraint failed on ${name}.${key}`), {
            code: "P2002",
            meta: { target: [key] },
          });
        }
      }
      const row = { ...data, id: nextId++ };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: { where: { id: number }; data: Record<string, unknown> }) => {
      const row = rows.find((r) => r.id === where.id)!;
      Object.assign(row, data);
      return row;
    },
  };
}

const tables = {
  templatePage: createTable("TemplatePage", ["slug", "customDomain"]),
  bioBlock: createTable("BioBlock"),
  customDomain: createTable("CustomDomain"),
  link: createTable("Link"),
};

const fakePrisma = {
  ...tables,
  $transaction: async <T>(fn: (tx: typeof fakePrisma) => Promise<T>) => fn(fakePrisma),
};

mock.module("@/server/db", () => ({ prisma: fakePrisma }));
// Guards Next server modules against client bundles; meaningless under bun test.
mock.module("server-only", () => ({}));

// Creating a hidden tracking link runs URL-safety checks over the network; the
// duplicate only needs one per link block, so stand in for the module.
let preparedCount = 0;
mock.module("@/server/lib/tracking-link", () => ({
  prepareHiddenTrackingLink: async (_ctx: unknown, opts: { url: string; name: string }) => {
    preparedCount++;
    return { values: { url: opts.url, name: opts.name, alias: `t${preparedCount}` } };
  },
  insertHiddenTrackingLink: async (
    tx: typeof fakePrisma,
    _ctx: unknown,
    prepared: { values: Record<string, unknown> },
  ) => (await tx.link.create({ data: prepared.values })).id,
  updateHiddenTrackingLink: async () => undefined,
  deleteHiddenTrackingLink: async () => undefined,
  purgeTrackingLinkCache: () => undefined,
}));

const { redis } = await import("@/lib/core/cache");
Object.assign(redis, { get: async () => null, set: async () => "OK", del: async () => 1 });

const services = await import("./template-page.service");

const TEAM = 7;
const ID = "5f8d0d55b54764421b7156c9";

const ctx = {
  auth: { userId: "user_1" },
  prisma: fakePrisma,
  workspace: {
    type: "team",
    userId: "user_1",
    teamId: TEAM,
    teamSlug: "acme",
    role: "member",
    plan: "ultra",
  },
} as never;

const publicCtx = { prisma: fakePrisma } as never;

function seedPage(overrides: Record<string, unknown> = {}) {
  return {
    userId: "user_1",
    teamId: TEAM,
    slug: "source-page",
    title: "Source product",
    description: "About the product",
    avatarUrl: null,
    theme: { preset: "midnight" },
    socialImageUrl: "https://cdn.example/og.png",
    seoTitle: "SEO title",
    seoDescription: "SEO description",
    removeBranding: false,
    isPublished: true,
    templateType: "bio",
    templateData: null,
    qrDesign: { fgColor: "#111111" },
    shareDomain: "old-domain.com",
    customDomain: "old-domain.com",
    pathPrefix: "productdetails",
    ...overrides,
  };
}

beforeEach(() => {
  preparedCount = 0;
  tables.customDomain.reset([
    { domain: "old-domain.com", status: "active", userId: "user_1", teamId: TEAM },
    { domain: "brand.com", status: "active", userId: "user_1", teamId: TEAM },
    { domain: "other-team.com", status: "active", userId: "user_9", teamId: 99 },
  ]);
  tables.templatePage.reset([
    seedPage({ slug: ID }),
    seedPage({
      slug: "spring",
      shareDomain: "brand.com",
      customDomain: null,
      pathPrefix: "p",
    }),
  ]);
  tables.link.reset([{ url: "https://shop.example/a", alias: "orig" }]);
  tables.bioBlock.reset([
    { templatePageId: 1, type: "heading", title: "Hello", position: 0, isVisible: true },
    {
      templatePageId: 1,
      type: "link",
      title: "Buy",
      url: "https://shop.example/a",
      linkId: 1,
      position: 1,
      isVisible: true,
    },
    { templatePageId: 1, type: "text", content: "Fine print", position: 2, isVisible: false },
  ]);
});

describe("public resolver — path prefix", () => {
  test("serves a productdetails page at its own prefix on a verified workspace domain", async () => {
    const page = await services.getPublicTemplatePageBySlugForHost(
      publicCtx,
      ID,
      "old-domain.com",
      "productdetails",
    );
    expect(page?.slug).toBe(ID);
    expect(page?.pathPrefix).toBe("productdetails");
  });

  test("any verified domain of the workspace serves it, upper-case ids included", async () => {
    const page = await services.getPublicTemplatePageBySlugForHost(
      publicCtx,
      ID.toUpperCase(),
      "brand.com",
      "productdetails",
    );
    expect(page?.slug).toBe(ID);
  });

  test("one URL per page: a productdetails page is not found at /p, and vice versa", async () => {
    expect(
      await services.getPublicTemplatePageBySlugForHost(publicCtx, ID, "old-domain.com", "p"),
    ).toBeNull();
    expect(
      await services.getPublicTemplatePageBySlugForHost(
        publicCtx,
        "spring",
        "brand.com",
        "productdetails",
      ),
    ).toBeNull();
    expect(
      (await services.getPublicTemplatePageBySlugForHost(publicCtx, "spring", "brand.com", "p"))
        ?.slug,
    ).toBe("spring");
  });

  test("a domain of another workspace is refused", async () => {
    expect(
      await services.getPublicTemplatePageBySlugForHost(
        publicCtx,
        ID,
        "other-team.com",
        "productdetails",
      ),
    ).toBeNull();
  });
});

describe("path prefix rule", () => {
  test("update refuses a non-/p prefix without a custom domain", async () => {
    await expect(
      services.updateTemplatePage(ctx, { id: 2, shareDomain: null, pathPrefix: "productdetails" }),
    ).rejects.toThrow(/custom domain/);
  });

  test("update accepts it with a custom domain", async () => {
    await services.updateTemplatePage(ctx, { id: 2, pathPrefix: "productdetails" });
    expect(tables.templatePage.all()[1]?.pathPrefix).toBe("productdetails");
  });

  test("moving a page back to the platform domain resets its prefix to /p", async () => {
    await services.updateTemplatePage(ctx, { id: 1, shareDomain: null });
    const page = tables.templatePage.all()[0]!;
    expect(page.shareDomain).toBeNull();
    expect(page.customDomain).toBeNull();
    expect(page.pathPrefix).toBe("p");
  });

  test("duplicate refuses a non-/p prefix without a custom domain", async () => {
    await expect(
      services.duplicateTemplatePage(ctx, {
        id: 1,
        slug: "5f8d0d55b54764421b7156ca",
        shareDomain: null,
        pathPrefix: "productdetails",
      }),
    ).rejects.toThrow(/custom domain/);
  });
});

describe("duplicateTemplatePage", () => {
  const NEW_ID = "6a1e2f3b4c5d6e7f8a9b0c1d";

  test("copies the page and its blocks in order, unpublished, without the root binding", async () => {
    const result = await services.duplicateTemplatePage(ctx, {
      id: 1,
      slug: NEW_ID,
      shareDomain: "old-domain.com",
      pathPrefix: "productdetails",
    });

    const copy = tables.templatePage.all().find((p) => p.id === result?.id)!;
    expect(copy).toMatchObject({
      slug: NEW_ID,
      teamId: TEAM,
      title: "Source product",
      description: "About the product",
      theme: { preset: "midnight" },
      socialImageUrl: "https://cdn.example/og.png",
      seoTitle: "SEO title",
      seoDescription: "SEO description",
      qrDesign: { fgColor: "#111111" },
      templateType: "bio",
      shareDomain: "old-domain.com",
      pathPrefix: "productdetails",
      customDomain: null,
      isPublished: false,
    });

    const blocks = await tables.bioBlock.findMany({ where: { templatePageId: copy.id } });
    expect(blocks.map((b) => [b.type, b.position])).toEqual([
      ["heading", 0],
      ["link", 1],
      ["text", 2],
    ]);
    expect(blocks[2]?.isVisible).toBe(false);
    // The link block gets its own tracking link instead of sharing the source's.
    expect(blocks[1]?.linkId).not.toBe(1);
    expect(blocks[1]?.url).toBe("https://shop.example/a");

    // ...and the copy resolves at its own URL once published.
    await services.togglePublished(ctx, { id: copy.id, isPublished: true });
    expect(
      (
        await services.getPublicTemplatePageBySlugForHost(
          publicCtx,
          NEW_ID,
          "old-domain.com",
          "productdetails",
        )
      )?.id,
    ).toBe(copy.id);
  });

  test("refuses a taken slug with the duplicate-handle error", async () => {
    await expect(
      services.duplicateTemplatePage(ctx, { id: 1, slug: "spring", shareDomain: null }),
    ).rejects.toThrow(/already taken/);
  });

  test("refuses a domain outside the workspace", async () => {
    await expect(
      services.duplicateTemplatePage(ctx, { id: 1, slug: NEW_ID, shareDomain: "other-team.com" }),
    ).rejects.toThrow();
  });

  test("cannot duplicate a page from another workspace", async () => {
    tables.templatePage.reset([seedPage({ teamId: 99, userId: "user_9" })]);
    await expect(
      services.duplicateTemplatePage(ctx, { id: 1, slug: NEW_ID, shareDomain: null }),
    ).rejects.toThrow();
  });
});
