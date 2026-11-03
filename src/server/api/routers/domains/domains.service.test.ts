import { describe, expect, mock, test } from "bun:test";

// Cloudflare is called over the network when the last workspace drops a domain.
mock.module("./utils", () => ({
  addDomainToCloudflare: async () => undefined,
  getCustomHostnameFromCloudflare: async () => null,
  deleteCustomHostnameFromCloudflare: async () => undefined,
}));

const { deleteDomainAndAssociatedLinks } = await import("./domains.service");

describe("deleteDomainAndAssociatedLinks", () => {
  test("moves the workspace's pages on that domain back to the platform, in the same transaction", async () => {
    const calls: { model: string; op: string; args: unknown }[] = [];
    const record =
      (model: string, op: string, result: unknown = { count: 0 }) =>
      async (args: unknown) => {
        calls.push({ model, op, args });
        return result;
      };
    const tx = {
      link: {
        findMany: record("link", "findMany", [{ id: 1 }, { id: 2 }]),
        deleteMany: record("link", "deleteMany"),
      },
      linkVisit: { deleteMany: record("linkVisit", "deleteMany") },
      templatePage: { updateMany: record("templatePage", "updateMany", { count: 3 }) },
      customDomain: {
        findFirst: record("customDomain", "findFirst", null),
        delete: record("customDomain", "delete"),
      },
    };
    let inTransaction = false;
    const prisma = {
      customDomain: {
        findFirst: async () => ({ id: 4, domain: "old-domain.com", teamId: 7 }),
      },
      $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => {
        inTransaction = true;
        return fn(tx);
      },
    };
    const ctx = {
      auth: { userId: "user_1" },
      prisma,
      workspace: { type: "team", userId: "user_1", teamId: 7, role: "owner", plan: "ultra" },
    } as never;

    const result = await deleteDomainAndAssociatedLinks(ctx, 4);

    expect(inTransaction).toBe(true);
    expect(result).toMatchObject({ deletedLinks: 2, movedPages: 3 });
    const pageUpdates = calls.filter((c) => c.model === "templatePage").map((c) => c.args);
    expect(pageUpdates).toEqual([
      {
        where: { teamId: 7, shareDomain: "old-domain.com" },
        data: { shareDomain: null, customDomain: null, pathPrefix: "p" },
      },
      { where: { teamId: 7, customDomain: "old-domain.com" }, data: { customDomain: null } },
    ]);
  });

  test("members without domains.delete cannot delete a team domain", async () => {
    const ctx = {
      auth: { userId: "user_1" },
      prisma: {},
      workspace: { type: "team", userId: "user_1", teamId: 7, role: "admin", plan: "ultra" },
    } as never;
    await expect(deleteDomainAndAssociatedLinks(ctx, 4)).rejects.toThrow(/permission/);
  });
});
