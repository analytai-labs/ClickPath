const fs = require('fs');
let code = fs.readFileSync('src/server/api/routers/account-transfer/account-transfer.service.ts', 'utf8');

// 1. Imports
code = code.replace(/import { and, eq, inArray, isNull, sql } from "drizzle-orm";\n/, "");
code = code.replace(/import \{\n  accountTransfer,\n  bioPage,\n  campaign,\n  customDomain,\n  folder,\n  link,\n  linkTag,\n  qrcode,\n  qrPreset,\n  tag,\n  user,\n  utmTemplate,\n\} from "@\/server\/db\/schema";\n/, "");

// 2. countUserResources
code = code.replace(/async function countUserResources\([\s\S]*?return \{[\s\S]*?\};\n\}/, `async function countUserResources(
  userId: string,
  prisma: any
): Promise<ResourceCounts> {
  const [links, domains, qrCodes, folders, tags, utmTemplates, qrPresets] =
    await Promise.all([
      prisma.link.count({ where: { userId, teamId: null } }),
      prisma.customDomain.count({ where: { userId, teamId: null } }),
      prisma.qrcode.count({ where: { userId, teamId: null } }),
      prisma.folder.count({ where: { userId, teamId: null } }),
      prisma.tag.count({ where: { userId, teamId: null } }),
      prisma.utmTemplate.count({ where: { userId, teamId: null } }),
      prisma.qrPreset.count({ where: { userId, teamId: null } }),
    ]);

  return {
    links,
    customDomains: domains,
    qrCodes,
    folders,
    tags,
    utmTemplates,
    qrPresets,
  };
}`);

// 3. validateAccountTransfer queries
code = code.replace(
  `  const sourceUser = await ctx.db.query.user.findFirst({\n    where: eq(user.id, ctx.auth.userId),\n  });`,
  `  const sourceUser = await ctx.prisma.user.findFirst({\n    where: { id: ctx.auth.userId },\n  });`
);

code = code.replace(
  `  const targetUser = await ctx.db.query.user.findFirst({\n    where: eq(user.email, targetEmail.toLowerCase()),\n    with: { subscriptions: true },\n  });`,
  `  const targetUser = await ctx.prisma.user.findFirst({\n    where: { email: targetEmail.toLowerCase() },\n    include: { subscriptions: true },\n  });`
);

code = code.replace(
  `  const pendingTransferConditions = [\n    eq(accountTransfer.fromUserId, ctx.auth.userId),\n    eq(accountTransfer.status, "pending"),\n  ];\n\n  // If we're revalidating during accept, exclude the current transfer from the check\n  if (excludeTransferId !== undefined) {\n    pendingTransferConditions.push(\n      sql\`\${accountTransfer.id} != \${excludeTransferId}\`\n    );\n  }\n\n  const existingTransfer = await ctx.db.query.accountTransfer.findFirst({\n    where: and(...pendingTransferConditions),\n  });`,
  `  const existingTransfer = await ctx.prisma.accountTransfer.findFirst({\n    where: {\n      fromUserId: ctx.auth.userId,\n      status: "pending",\n      ...(excludeTransferId !== undefined ? { id: { not: excludeTransferId } } : {}),\n    },\n  });`
);

code = code.replace(
  `const resourceCounts = await countUserResources(ctx.auth.userId, ctx.db);`,
  `const resourceCounts = await countUserResources(ctx.auth.userId, ctx.prisma);`
);

code = code.replace(
  `const targetCurrentCounts = await countUserResources(targetUser.id, ctx.db);`,
  `const targetCurrentCounts = await countUserResources(targetUser.id, ctx.prisma);`
);

code = code.replace(
  `    const [sourceFolders, targetFolders] = await Promise.all([\n      ctx.db.query.folder.findMany({\n        where: and(eq(folder.userId, ctx.auth.userId), isNull(folder.teamId)),\n        columns: { name: true },\n      }),\n      ctx.db.query.folder.findMany({\n        where: and(eq(folder.userId, targetUser.id), isNull(folder.teamId)),\n        columns: { name: true },\n      }),\n    ]);`,
  `    const [sourceFolders, targetFolders] = await Promise.all([\n      ctx.prisma.folder.findMany({\n        where: { userId: ctx.auth.userId, teamId: null },\n        select: { name: true },\n      }),\n      ctx.prisma.folder.findMany({\n        where: { userId: targetUser.id, teamId: null },\n        select: { name: true },\n      }),\n    ]);`
);

code = code.replace(
  `    const [srcCampaignRows, tgtCampaignRows] = await Promise.all([\n      ctx.db\n        .select({ count: sql<number>\`count(*)\` })\n        .from(campaign)\n        .where(\n          and(\n            eq(campaign.userId, ctx.auth.userId),\n            isNull(campaign.teamId),\n            eq(campaign.status, "active")\n          )\n        ),\n      ctx.db\n        .select({ count: sql<number>\`count(*)\` })\n        .from(campaign)\n        .where(\n          and(\n            eq(campaign.userId, targetUser.id),\n            isNull(campaign.teamId),\n            eq(campaign.status, "active")\n          )\n        ),\n    ]);\n    const srcCampaigns = Number(srcCampaignRows[0]?.count ?? 0);\n    if (srcCampaigns > 0) {\n      const newTotal = Number(tgtCampaignRows[0]?.count ?? 0) + srcCampaigns;`,
  `    const [srcCampaigns, tgtCampaigns] = await Promise.all([\n      ctx.prisma.campaign.count({\n        where: { userId: ctx.auth.userId, teamId: null, status: "active" },\n      }),\n      ctx.prisma.campaign.count({\n        where: { userId: targetUser.id, teamId: null, status: "active" },\n      }),\n    ]);\n    if (srcCampaigns > 0) {\n      const newTotal = tgtCampaigns + srcCampaigns;`
);

code = code.replace(
  `    const [srcBioRows, tgtBioRows] = await Promise.all([\n      ctx.db\n        .select({ count: sql<number>\`count(*)\` })\n        .from(bioPage)\n        .where(and(eq(bioPage.userId, ctx.auth.userId), isNull(bioPage.teamId))),\n      ctx.db\n        .select({ count: sql<number>\`count(*)\` })\n        .from(bioPage)\n        .where(and(eq(bioPage.userId, targetUser.id), isNull(bioPage.teamId))),\n    ]);\n    const srcBioPages = Number(srcBioRows[0]?.count ?? 0);\n    if (srcBioPages > 0) {\n      const newTotal = Number(tgtBioRows[0]?.count ?? 0) + srcBioPages;`,
  `    const [srcBioPages, tgtBioPages] = await Promise.all([\n      ctx.prisma.bioPage.count({\n        where: { userId: ctx.auth.userId, teamId: null },\n      }),\n      ctx.prisma.bioPage.count({\n        where: { userId: targetUser.id, teamId: null },\n      }),\n    ]);\n    if (srcBioPages > 0) {\n      const newTotal = tgtBioPages + srcBioPages;`
);

code = code.replace(
  `  const [result] = await ctx.db.insert(accountTransfer).values({\n    fromUserId: ctx.auth.userId,\n    toEmail: input.targetEmail.toLowerCase(),\n    toUserId: validation.targetUserId,\n    token,\n    status: "pending",\n    linksCount: validation.resourceCounts.links,\n    customDomainsCount: validation.resourceCounts.customDomains,\n    qrCodesCount: validation.resourceCounts.qrCodes,\n    foldersCount: validation.resourceCounts.folders,\n    tagsCount: validation.resourceCounts.tags,\n    utmTemplatesCount: validation.resourceCounts.utmTemplates,\n    qrPresetsCount: validation.resourceCounts.qrPresets,\n    expiresAt,\n  });\n\n  // Get source user details for email\n  const sourceUser = await ctx.db.query.user.findFirst({\n    where: eq(user.id, ctx.auth.userId),\n    columns: { name: true, email: true },\n  });\n\n  const targetUser = await ctx.db.query.user.findFirst({\n    where: eq(user.id, validation.targetUserId!),\n    columns: { name: true },\n  });`,
  `  const result = await ctx.prisma.accountTransfer.create({\n    data: {\n      fromUserId: ctx.auth.userId,\n      toEmail: input.targetEmail.toLowerCase(),\n      toUserId: validation.targetUserId,\n      token,\n      status: "pending",\n      linksCount: validation.resourceCounts.links,\n      customDomainsCount: validation.resourceCounts.customDomains,\n      qrCodesCount: validation.resourceCounts.qrCodes,\n      foldersCount: validation.resourceCounts.folders,\n      tagsCount: validation.resourceCounts.tags,\n      utmTemplatesCount: validation.resourceCounts.utmTemplates,\n      qrPresetsCount: validation.resourceCounts.qrPresets,\n      expiresAt,\n    },\n  });\n\n  // Get source user details for email\n  const sourceUser = await ctx.prisma.user.findFirst({\n    where: { id: ctx.auth.userId },\n    select: { name: true, email: true },\n  });\n\n  const targetUser = await ctx.prisma.user.findFirst({\n    where: { id: validation.targetUserId! },\n    select: { name: true },\n  });`
);

code = code.replace(
  `    transferId: Number(result.insertId),`,
  `    transferId: result.id,`
);

code = code.replace(
  `  const transfer = await ctx.db.query.accountTransfer.findFirst({\n    where: eq(accountTransfer.token, token),\n    with: {\n      fromUser: {\n        columns: {\n          id: true,\n          name: true,\n          email: true,\n        },\n      },\n    },\n  });`,
  `  const transfer = await ctx.prisma.accountTransfer.findFirst({\n    where: { token },\n    include: {\n      fromUser: {\n        select: {\n          id: true,\n          name: true,\n          email: true,\n        },\n      },\n    },\n  });`
);

code = code.replace(
  `  const transfer = await ctx.db.query.accountTransfer.findFirst({\n    where: and(\n      eq(accountTransfer.fromUserId, ctx.auth.userId),\n      eq(accountTransfer.status, "pending")\n    ),\n  });`,
  `  const transfer = await ctx.prisma.accountTransfer.findFirst({\n    where: {\n      fromUserId: ctx.auth.userId,\n      status: "pending"\n    },\n  });`
);

code = code.replace(
  `  const transfer = await ctx.db.query.accountTransfer.findFirst({\n    where: eq(accountTransfer.token, input.token),\n  });`,
  `  const transfer = await ctx.prisma.accountTransfer.findFirst({\n    where: { token: input.token },\n  });`
);

code = code.replace(
  `  const currentUser = await ctx.db.query.user.findFirst({\n    where: eq(user.id, ctx.auth.userId),\n  });`,
  `  const currentUser = await ctx.prisma.user.findFirst({\n    where: { id: ctx.auth.userId },\n  });`
);

code = code.replace(
  `    await ctx.db\n      .update(accountTransfer)\n      .set({ status: "expired" })\n      .where(eq(accountTransfer.id, transfer.id));`,
  `    await ctx.prisma.accountTransfer.update({\n      where: { id: transfer.id },\n      data: { status: "expired" },\n    });`
);

code = code.replace(
  `  const sourceUser = await ctx.db.query.user.findFirst({\n    where: eq(user.id, transfer.fromUserId),\n    columns: { name: true, email: true },\n  });`,
  `  const sourceUser = await ctx.prisma.user.findFirst({\n    where: { id: transfer.fromUserId },\n    select: { name: true, email: true },\n  });`
);

code = code.replace(
  `  await ctx.db.transaction(async (tx) => {`,
  `  await ctx.prisma.$transaction(async (tx) => {`
);

code = code.replace(
  `    const claimResult = await tx\n      .update(accountTransfer)\n      .set({\n        status: "accepted",\n        acceptedAt: new Date(),\n        toUserId: toUserId,\n      })\n      .where(\n        and(\n          eq(accountTransfer.id, transferId),\n          eq(accountTransfer.status, "pending")\n        )\n      );\n\n    if (claimResult[0].affectedRows === 0) {`,
  `    const claimResult = await tx.accountTransfer.updateMany({\n      where: {\n        id: transferId,\n        status: "pending",\n      },\n      data: {\n        status: "accepted",\n        acceptedAt: new Date(),\n        toUserId: toUserId,\n      },\n    });\n\n    if (claimResult.count === 0) {`
);

code = code.replace(
  `    const sourceFolders = await tx.query.folder.findMany({\n      where: and(eq(folder.userId, fromUserId), isNull(folder.teamId)),\n    });\n\n    const targetFolders = await tx.query.folder.findMany({\n      where: and(eq(folder.userId, toUserId), isNull(folder.teamId)),\n    });`,
  `    const sourceFolders = await tx.folder.findMany({\n      where: { userId: fromUserId, teamId: null },\n    });\n\n    const targetFolders = await tx.folder.findMany({\n      where: { userId: toUserId, teamId: null },\n    });`
);

code = code.replace(
  `        const [newFolder] = await tx.insert(folder).values({\n          name: sourceFolder.name,\n          description: sourceFolder.description,\n          userId: toUserId,\n          teamId: null,\n          isRestricted: false, // Reset restriction (no team context)\n        });\n        const newFolderId = Number(newFolder.insertId);`,
  `        const newFolder = await tx.folder.create({\n          data: {\n            name: sourceFolder.name,\n            description: sourceFolder.description,\n            userId: toUserId,\n            teamId: null,\n            isRestricted: false, // Reset restriction (no team context)\n          },\n        });\n        const newFolderId = newFolder.id;`
);

code = code.replace(
  `    const sourceTags = await tx.query.tag.findMany({\n      where: and(eq(tag.userId, fromUserId), isNull(tag.teamId)),\n    });\n\n    const targetTags = await tx.query.tag.findMany({\n      where: and(eq(tag.userId, toUserId), isNull(tag.teamId)),\n    });`,
  `    const sourceTags = await tx.tag.findMany({\n      where: { userId: fromUserId, teamId: null },\n    });\n\n    const targetTags = await tx.tag.findMany({\n      where: { userId: toUserId, teamId: null },\n    });`
);

code = code.replace(
  `        const [newTag] = await tx.insert(tag).values({\n          name: sourceTag.name,\n          userId: toUserId,\n          teamId: null,\n        });\n        const newTagId = Number(newTag.insertId);`,
  `        const newTag = await tx.tag.create({\n          data: {\n            name: sourceTag.name,\n            userId: toUserId,\n            teamId: null,\n          },\n        });\n        const newTagId = newTag.id;`
);

code = code.replace(
  `    const sourceLinks = await tx.query.link.findMany({\n      where: and(eq(link.userId, fromUserId), isNull(link.teamId)),\n    });`,
  `    const sourceLinks = await tx.link.findMany({\n      where: { userId: fromUserId, teamId: null },\n    });`
);

code = code.replace(
  `      const sourceLinkTags = await tx.query.linkTag.findMany({\n        where: inArray(linkTag.linkId, linkIds),\n      });`,
  `      const sourceLinkTags = await tx.linkTag.findMany({\n        where: { linkId: { in: linkIds } },\n      });`
);

code = code.replace(
  `        await tx\n          .update(link)\n          .set({\n            userId: toUserId,\n            teamId: null,\n            folderId: newFolderId,\n          })\n          .where(eq(link.id, sourceLink.id));`,
  `        await tx.link.update({\n          where: { id: sourceLink.id },\n          data: {\n            userId: toUserId,\n            teamId: null,\n            folderId: newFolderId,\n          },\n        });`
);

code = code.replace(
  `      if (sourceLinkTags.length > 0) {\n        await tx.delete(linkTag).where(inArray(linkTag.linkId, linkIds));\n      }`,
  `      if (sourceLinkTags.length > 0) {\n        await tx.linkTag.deleteMany({\n          where: { linkId: { in: linkIds } },\n        });\n      }`
);

code = code.replace(
  `      if (newLinkTags.length > 0) {\n        await tx.insert(linkTag).values(newLinkTags);\n      }`,
  `      if (newLinkTags.length > 0) {\n        await tx.linkTag.createMany({\n          data: newLinkTags,\n        });\n      }`
);

code = code.replace(
  `    const qrCodesUpdate = await tx\n      .update(qrcode)\n      .set({ userId: toUserId, teamId: null })\n      .where(and(eq(qrcode.userId, fromUserId), isNull(qrcode.teamId)));\n\n    result.qrCodesTransferred = qrCodesUpdate[0].affectedRows;`,
  `    const qrCodesUpdate = await tx.qrcode.updateMany({\n      where: { userId: fromUserId, teamId: null },\n      data: { userId: toUserId, teamId: null },\n    });\n\n    result.qrCodesTransferred = qrCodesUpdate.count;`
);

code = code.replace(
  `    const qrPresetsUpdate = await tx\n      .update(qrPreset)\n      .set({ userId: toUserId, teamId: null })\n      .where(and(eq(qrPreset.userId, fromUserId), isNull(qrPreset.teamId)));\n\n    result.qrPresetsTransferred = qrPresetsUpdate[0].affectedRows;`,
  `    const qrPresetsUpdate = await tx.qrPreset.updateMany({\n      where: { userId: fromUserId, teamId: null },\n      data: { userId: toUserId, teamId: null },\n    });\n\n    result.qrPresetsTransferred = qrPresetsUpdate.count;`
);

code = code.replace(
  `    const domainsUpdate = await tx\n      .update(customDomain)\n      .set({ userId: toUserId, teamId: null })\n      .where(and(eq(customDomain.userId, fromUserId), isNull(customDomain.teamId)));\n\n    result.customDomainsTransferred = domainsUpdate[0].affectedRows;`,
  `    const domainsUpdate = await tx.customDomain.updateMany({\n      where: { userId: fromUserId, teamId: null },\n      data: { userId: toUserId, teamId: null },\n    });\n\n    result.customDomainsTransferred = domainsUpdate.count;`
);

code = code.replace(
  `    const utmUpdate = await tx\n      .update(utmTemplate)\n      .set({ userId: toUserId, teamId: null })\n      .where(and(eq(utmTemplate.userId, fromUserId), isNull(utmTemplate.teamId)));\n\n    result.utmTemplatesTransferred = utmUpdate[0].affectedRows;`,
  `    const utmUpdate = await tx.utmTemplate.updateMany({\n      where: { userId: fromUserId, teamId: null },\n      data: { userId: toUserId, teamId: null },\n    });\n\n    result.utmTemplatesTransferred = utmUpdate.count;`
);

code = code.replace(
  `    const bioPagesUpdate = await tx\n      .update(bioPage)\n      .set({ userId: toUserId, teamId: null })\n      .where(and(eq(bioPage.userId, fromUserId), isNull(bioPage.teamId)));\n\n    result.bioPagesTransferred = bioPagesUpdate[0].affectedRows;`,
  `    const bioPagesUpdate = await tx.bioPage.updateMany({\n      where: { userId: fromUserId, teamId: null },\n      data: { userId: toUserId, teamId: null },\n    });\n\n    result.bioPagesTransferred = bioPagesUpdate.count;`
);

code = code.replace(
  `    const [sourceCampaigns, targetCampaigns] = await Promise.all([\n      tx.query.campaign.findMany({\n        where: and(eq(campaign.userId, fromUserId), isNull(campaign.teamId)),\n        columns: { id: true, slug: true, name: true },\n      }),\n      tx.query.campaign.findMany({\n        where: and(eq(campaign.userId, toUserId), isNull(campaign.teamId)),\n        columns: { slug: true, name: true },\n      }),\n    ]);`,
  `    const [sourceCampaigns, targetCampaigns] = await Promise.all([\n      tx.campaign.findMany({\n        where: { userId: fromUserId, teamId: null },\n        select: { id: true, slug: true, name: true },\n      }),\n      tx.campaign.findMany({\n        where: { userId: toUserId, teamId: null },\n        select: { slug: true, name: true },\n      }),\n    ]);`
);

code = code.replace(
  `      await tx\n        .update(campaign)\n        .set({ slug: newSlug, name: newName })\n        .where(eq(campaign.id, sourceCampaign.id));`,
  `      await tx.campaign.update({\n        where: { id: sourceCampaign.id },\n        data: { slug: newSlug, name: newName },\n      });`
);

code = code.replace(
  `    const campaignsUpdate = await tx\n      .update(campaign)\n      .set({ userId: toUserId, teamId: null })\n      .where(and(eq(campaign.userId, fromUserId), isNull(campaign.teamId)));\n\n    result.campaignsTransferred = campaignsUpdate[0].affectedRows;`,
  `    const campaignsUpdate = await tx.campaign.updateMany({\n      where: { userId: fromUserId, teamId: null },\n      data: { userId: toUserId, teamId: null },\n    });\n\n    result.campaignsTransferred = campaignsUpdate.count;`
);

code = code.replace(
  `    if (sourceFolders.length > 0) {\n      await tx.delete(folder).where(\n        and(eq(folder.userId, fromUserId), isNull(folder.teamId))\n      );\n    }`,
  `    if (sourceFolders.length > 0) {\n      await tx.folder.deleteMany({\n        where: { userId: fromUserId, teamId: null },\n      });\n    }`
);

code = code.replace(
  `    if (sourceTags.length > 0) {\n      await tx.delete(tag).where(\n        and(eq(tag.userId, fromUserId), isNull(tag.teamId))\n      );\n    }`,
  `    if (sourceTags.length > 0) {\n      await tx.tag.deleteMany({\n        where: { userId: fromUserId, teamId: null },\n      });\n    }`
);

code = code.replace(
  `  const transfer = await ctx.db.query.accountTransfer.findFirst({\n    where: eq(accountTransfer.id, input.transferId),\n  });`,
  `  const transfer = await ctx.prisma.accountTransfer.findFirst({\n    where: { id: input.transferId },\n  });`
);

code = code.replace(
  `  await ctx.db\n    .update(accountTransfer)\n    .set({ status: "cancelled" })\n    .where(eq(accountTransfer.id, input.transferId));`,
  `  await ctx.prisma.accountTransfer.update({\n    where: { id: input.transferId },\n    data: { status: "cancelled" },\n  });`
);

code = code.replace(
  `  const transfer = await ctx.db.query.accountTransfer.findFirst({\n    where: eq(accountTransfer.token, input.token),\n  });`,
  `  const transfer = await ctx.prisma.accountTransfer.findFirst({\n    where: { token: input.token },\n  });`
);

code = code.replace(
  `  const currentUser = await ctx.db.query.user.findFirst({\n    where: eq(user.id, ctx.auth.userId),\n  });`,
  `  const currentUser = await ctx.prisma.user.findFirst({\n    where: { id: ctx.auth.userId },\n  });`
);

code = code.replace(
  `  await ctx.db\n    .update(accountTransfer)\n    .set({ status: "declined" })\n    .where(eq(accountTransfer.id, transfer.id));`,
  `  await ctx.prisma.accountTransfer.update({\n    where: { id: transfer.id },\n    data: { status: "declined" },\n  });`
);

code = code.replace(
  `  const sourceUser = await ctx.db.query.user.findFirst({\n    where: eq(user.id, transfer.fromUserId),\n    columns: { name: true, email: true },\n  });`,
  `  const sourceUser = await ctx.prisma.user.findFirst({\n    where: { id: transfer.fromUserId },\n    select: { name: true, email: true },\n  });`
);


fs.writeFileSync('src/server/api/routers/account-transfer/account-transfer.service.ts', code);
console.log('Migration complete');
