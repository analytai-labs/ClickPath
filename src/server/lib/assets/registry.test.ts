import { beforeEach, describe, expect, mock, test } from "bun:test";

const IMAGE = "https://r2.example/bio-og/1.png";

type Page = { id: number; slug: string; title: string | null; socialImageUrl: string | null };

let pages: Page[] = [];
let linksWithImage: { id: number; alias: string }[] = [];
let asset: { id: number; library: boolean; storageKey: string | null } | null = null;
const deleted: string[] = [];

const fakePrisma = {
  asset: {
    findFirst: async () => asset,
    delete: async () => asset,
  },
  qrCode: { findMany: async () => [] },
  qrPreset: { findMany: async () => [] },
  link: { findMany: async () => linksWithImage },
  templatePage: {
    findMany: async () =>
      pages.map((p) => ({ ...p, avatarUrl: null, templateData: null, qrDesign: null })),
  },
};

// Guards Next server modules against client bundles; meaningless under bun test.
mock.module("server-only", () => ({}));
mock.module("@/server/lib/storage", () => ({
  isManagedImageUrl: (url: unknown) => typeof url === "string" && url.startsWith("https://r2."),
  deleteImage: async (url: string) => {
    deleted.push(url);
  },
  deleteImageByKey: async (key: string) => {
    deleted.push(key);
  },
  isUploadableDataUrl: () => false,
  uploadImage: async () => null,
  uploadImageDetailed: async () => {
    throw new Error("not used");
  },
  isR2Configured: () => false,
  resetStorageProvider: () => undefined,
}));

const { releaseImage, releaseImages } = await import("./registry");

const ctx = {
  auth: { userId: "user_1" },
  prisma: fakePrisma,
  workspace: { type: "team", userId: "user_1", teamId: 7, role: "owner", plan: "ultra" },
} as never;

beforeEach(() => {
  pages = [];
  linksWithImage = [];
  asset = { id: 1, library: false, storageKey: "bio-og/1.png" };
  deleted.length = 0;
});

describe("releaseImage", () => {
  test("keeps an inline image another page still uses (e.g. a duplicated page)", async () => {
    // The source page was deleted; its copy still shows the same image.
    pages = [{ id: 2, slug: "copy", title: null, socialImageUrl: IMAGE }];
    await releaseImages(ctx, [IMAGE]);
    expect(deleted).toEqual([]);
  });

  test("deletes an inline image nothing references any more", async () => {
    await releaseImage(ctx, IMAGE);
    expect(deleted).toEqual(["bio-og/1.png"]);
  });

  test("a caller releasing before its own delete is not counted as a user", async () => {
    linksWithImage = [{ id: 5, alias: "spring" }];
    await releaseImage(ctx, IMAGE, { except: { kind: "link", id: 5 } });
    expect(deleted).toEqual(["bio-og/1.png"]);
  });

  test("never deletes a saved library asset", async () => {
    asset = { id: 1, library: true, storageKey: "bio-og/1.png" };
    await releaseImage(ctx, IMAGE);
    expect(deleted).toEqual([]);
  });
});
