import { beforeEach, describe, expect, mock, test } from "bun:test";

// The services read Prisma and Redis through module singletons; swap both for
// in-memory fakes before the services are imported.
type DomainRow = { domain: string; status: string; userId: string; teamId: number | null };

const db = {
  domains: [] as DomainRow[],
  teams: new Map<number, { id: number; defaultDomain: string | null }>(),
  siteSettings: new Map<string, { userId: string; defaultDomain: string }>(),
};

function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => row[key] === value);
}

const fakePrisma = {
  customDomain: {
    findFirst: async ({ where }: { where: Record<string, unknown> }) =>
      db.domains.find((d) => matches(d, where)) ?? null,
  },
  team: {
    findFirst: async ({ where }: { where: { id: number } }) => db.teams.get(where.id) ?? null,
    update: async ({ where, data }: { where: { id: number }; data: { defaultDomain: string } }) => {
      const team = { ...db.teams.get(where.id)!, ...data };
      db.teams.set(where.id, team);
      return team;
    },
  },
  siteSettings: {
    findFirst: async ({ where }: { where: { userId: string } }) =>
      db.siteSettings.get(where.userId) ?? null,
    create: async ({ data }: { data: { userId: string; defaultDomain: string } }) => {
      db.siteSettings.set(data.userId, data);
      return data;
    },
    updateMany: async ({
      where,
      data,
    }: { where: { userId: string }; data: { defaultDomain: string } }) => {
      db.siteSettings.set(where.userId, { userId: where.userId, ...data });
      return { count: 1 };
    },
  },
};

mock.module("@/server/db", () => ({ prisma: fakePrisma }));

// The Redis client connects lazily; stub the calls instead of mocking the module,
// so other importers keep the module's remaining exports.
const { redis } = await import("@/lib/core/cache");
Object.assign(redis, {
  get: async () => null,
  set: async () => "OK",
  del: async () => 1,
});

const { assertDomainAllowed, getWorkspaceDefaultDomain } = await import("../link/utils");
const { getSiteSettings, updateSiteSettings } = await import("./settings.service");

const USER = "user_member";

function personalCtx() {
  return {
    auth: { userId: USER },
    prisma: fakePrisma,
    workspace: { type: "personal", userId: USER, teamId: null, role: "owner", plan: "pro" },
  } as never;
}

function teamCtx(teamId: number, role: "owner" | "admin" | "member") {
  return {
    auth: { userId: USER },
    prisma: fakePrisma,
    workspace: { type: "team", userId: USER, teamId, teamSlug: `t${teamId}`, role, plan: "ultra" },
  } as never;
}

beforeEach(() => {
  db.domains = [
    // Team X's domain — USER is a member of team X, but does not own it.
    { domain: "go.team-x.com", status: "active", userId: "user_owner_x", teamId: 1 },
    // USER's own personal domain.
    { domain: "me.example.com", status: "active", userId: USER, teamId: null },
    // A domain USER registered inside team Y.
    { domain: "go.team-y.com", status: "active", userId: USER, teamId: 2 },
  ];
  db.teams = new Map([
    [1, { id: 1, defaultDomain: null }],
    [2, { id: 2, defaultDomain: null }],
  ]);
  db.siteSettings = new Map([[USER, { userId: USER, defaultDomain: "me.example.com" }]]);
});

describe("assertDomainAllowed — workspace scoping", () => {
  test("a team workspace may use that team's domains only", async () => {
    await expect(assertDomainAllowed(teamCtx(1, "member"), "go.team-x.com")).resolves.toBe(
      undefined,
    );
    await expect(assertDomainAllowed(teamCtx(1, "member"), "go.team-y.com")).rejects.toThrow();
    await expect(assertDomainAllowed(teamCtx(1, "member"), "me.example.com")).rejects.toThrow();
  });

  test("a personal workspace cannot use a team's domain, even one the user belongs to", async () => {
    await expect(assertDomainAllowed(personalCtx(), "go.team-x.com")).rejects.toThrow();
    // ...nor one the user registered inside a team.
    await expect(assertDomainAllowed(personalCtx(), "go.team-y.com")).rejects.toThrow();
    await expect(assertDomainAllowed(personalCtx(), "me.example.com")).resolves.toBe(undefined);
  });

  test("another team's workspace cannot use team X's domain", async () => {
    await expect(assertDomainAllowed(teamCtx(2, "owner"), "go.team-x.com")).rejects.toThrow();
  });

  test("platform domains are always allowed", async () => {
    await expect(assertDomainAllowed(personalCtx(), "clickpath.analytai.in")).resolves.toBe(
      undefined,
    );
  });
});

describe("team default domain", () => {
  test("a team without a default falls back to the platform domain, not the member's", async () => {
    expect(await getWorkspaceDefaultDomain(teamCtx(1, "member"))).toBe("clickpath.analytai.in");
  });

  test("a member without team.settings cannot change the team default", async () => {
    await expect(
      updateSiteSettings(teamCtx(1, "member"), { defaultDomain: "go.team-x.com" }),
    ).rejects.toThrow(/permission/);
    expect(db.teams.get(1)?.defaultDomain).toBeNull();
    expect(db.siteSettings.get(USER)?.defaultDomain).toBe("me.example.com");
  });

  test("an admin changes the team default, and only the team's", async () => {
    const result = await updateSiteSettings(teamCtx(1, "admin"), {
      defaultDomain: "go.team-x.com",
    });
    expect(db.teams.get(1)?.defaultDomain).toBe("go.team-x.com");
    expect(db.siteSettings.get(USER)?.defaultDomain).toBe("me.example.com");
    expect(result.defaultDomain).toBe("go.team-x.com");
    expect(result.canEditDefaultDomain).toBe(true);
  });

  test("an admin cannot set another workspace's domain as the team default", async () => {
    await expect(
      updateSiteSettings(teamCtx(1, "admin"), { defaultDomain: "me.example.com" }),
    ).rejects.toThrow();
  });

  test("the settings form sees the team default and whether it may edit it", async () => {
    const settings = await getSiteSettings(teamCtx(1, "member"));
    expect(settings.defaultDomain).toBe("clickpath.analytai.in");
    expect(settings.defaultDomainScope).toBe("team");
    expect(settings.canEditDefaultDomain).toBe(false);
  });

  test("the personal workspace changes the personal default", async () => {
    await updateSiteSettings(personalCtx(), { defaultDomain: "clk.path" });
    expect(db.siteSettings.get(USER)?.defaultDomain).toBe("clk.path");
    await expect(
      updateSiteSettings(personalCtx(), { defaultDomain: "go.team-x.com" }),
    ).rejects.toThrow();
  });
});
