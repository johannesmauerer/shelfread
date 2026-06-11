import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

/**
 * One-off maintenance: delete orphaned _storage blobs — files not referenced by
 * any series.coverImageId, issues.rawHtmlStorageId, issues.epubFileId, or
 * magazines.epubFileId. Repeated reprocessing during debugging left ~200 stale
 * EPUBs behind (storage.store() never frees the prior blob), pushing file
 * storage over the free-plan limit.
 *
 * Pass { dryRun: true } to report what WOULD be deleted without deleting.
 */
export const deleteOrphans = internalMutation({
  args: { dryRun: v.boolean() },
  handler: async (ctx, args) => {
    const referenced = new Set<string>();

    for (const s of await ctx.db.query("series").collect()) {
      if (s.coverImageId) referenced.add(s.coverImageId);
    }
    for (const i of await ctx.db.query("issues").collect()) {
      referenced.add(i.rawHtmlStorageId);
      if (i.epubFileId) referenced.add(i.epubFileId);
    }
    for (const m of await ctx.db.query("magazines").collect()) {
      if (m.epubFileId) referenced.add(m.epubFileId);
    }

    // System table: every stored file.
    const allFiles = await ctx.db.system.query("_storage").collect();

    const orphans = allFiles.filter((f) => !referenced.has(f._id));
    const orphanBytes = orphans.reduce((sum, f) => sum + f.size, 0);
    const totalBytes = allFiles.reduce((sum, f) => sum + f.size, 0);

    if (!args.dryRun) {
      for (const f of orphans) {
        await ctx.storage.delete(f._id);
      }
    }

    return {
      dryRun: args.dryRun,
      totalBlobs: allFiles.length,
      referencedBlobs: referenced.size,
      orphanBlobs: orphans.length,
      orphanMB: Math.round((orphanBytes / 1024 / 1024) * 10) / 10,
      totalMB: Math.round((totalBytes / 1024 / 1024) * 10) / 10,
      remainingMBAfter:
        Math.round(((totalBytes - orphanBytes) / 1024 / 1024) * 10) / 10,
    };
  },
});
