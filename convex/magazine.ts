"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { generateMagazineEpub } from "./lib/epub";
import type { Doc, Id } from "./_generated/dataModel";

// Delete a storage blob without letting a missing/already-deleted id throw.
// storage.delete raises StorageIdNotFound for a stale id, which would otherwise
// abort a magazine rebuild after the new EPUB is already stored.
async function deleteStorageSafe(
  ctx: { storage: { delete: (id: Id<"_storage">) => Promise<void> } },
  id: Id<"_storage">
): Promise<void> {
  try {
    await ctx.storage.delete(id);
  } catch (err) {
    console.warn(`Skipping delete of missing storage blob ${id}:`, err);
  }
}

/**
 * Rebuild (or create) the magazine for a given month.
 * Called after each issue is marked "ready".
 */
/**
 * Rebuild an existing magazine using its stored articleIds.
 * Skips any articleIds that no longer resolve (issue deleted).
 * Preserves article order; updates articleIds/articleCount accordingly.
 */
export const rebuildExistingMagazine = internalAction({
  args: { magazineId: v.id("magazines") },
  handler: async (ctx, args) => {
    const existing: Doc<"magazines"> | null = await ctx.runQuery(
      internal.magazineHelpers.getById,
      { id: args.magazineId }
    );
    if (!existing) {
      throw new Error(`Magazine ${args.magazineId} not found`);
    }

    const resolvedIssues: Doc<"issues">[] = await ctx.runQuery(
      internal.magazineHelpers.getIssuesByIds,
      { ids: existing.articleIds }
    );

    const resolvedIds = new Set(resolvedIssues.map((i) => i._id));
    const orderedIssues = existing.articleIds
      .filter((id) => resolvedIds.has(id))
      .map((id) => resolvedIssues.find((i) => i._id === id)!) as Doc<"issues">[];

    if (orderedIssues.length === 0) {
      throw new Error(`No resolvable articles for magazine ${args.magazineId}`);
    }

    const seriesCache = new Map<string, Doc<"series">>();
    const articles = [];
    for (const issue of orderedIssues) {
      let series = seriesCache.get(issue.seriesId);
      if (!series) {
        const s = await ctx.runQuery(internal.series.getInternal, {
          id: issue.seriesId,
        });
        if (s) {
          series = s;
          seriesCache.set(issue.seriesId, s);
        }
      }
      articles.push({
        issueId: issue._id,
        title: issue.title,
        author: issue.author ?? null,
        seriesName: series?.name ?? "Unknown",
        contentHtml: issue.cleanContent ?? "<p>Content unavailable.</p>",
        summary: issue.summary ?? null,
        issueDate: issue.issueDate
          ? new Date(issue.issueDate).toISOString().split("T")[0]
          : null,
      });
    }

    console.log(
      `Rebuilding ${existing.title} (${articles.length} articles, was ${existing.articleCount})`
    );

    const epubBuffer = await generateMagazineEpub({
      title: existing.title,
      issueNumber: existing.issueNumber,
      month: existing.month,
      articles,
    });

    const blob = new Blob([epubBuffer], { type: "application/epub+zip" });
    const epubFileId = await ctx.storage.store(blob);

    // Best-effort cleanup of the previous EPUB. A missing/already-deleted blob
    // must NOT abort the rebuild — otherwise the new EPUB is stored but the
    // magazine record never updates, leaving stale content and a leaked blob.
    if (existing.epubFileId) {
      await deleteStorageSafe(ctx, existing.epubFileId);
    }

    await ctx.runMutation(internal.magazineHelpers.update, {
      id: existing._id,
      title: existing.title,
      articleCount: articles.length,
      articleIds: orderedIssues.map((i) => i._id) as Id<"issues">[],
      epubFileId,
      epubSizeBytes: epubBuffer.length,
      updatedAt: Date.now(),
    });

    console.log(`Rebuilt ${existing.title}`);
  },
});

export const rebuildMagazine = internalAction({
  args: { month: v.string() },
  handler: async (ctx, args) => {
    // 1. Get all ready issues for this month
    const allIssues: Doc<"issues">[] = await ctx.runQuery(
      internal.magazineHelpers.listReadyIssuesByMonth,
      { month: args.month }
    );

    if (allIssues.length === 0) {
      console.log(`No ready issues for ${args.month}, skipping magazine`);
      return;
    }

    // 2. Get series info for each issue
    const seriesCache = new Map<string, Doc<"series">>();
    const articles = [];

    for (const issue of allIssues) {
      let series = seriesCache.get(issue.seriesId);
      if (!series) {
        const s = await ctx.runQuery(internal.series.getInternal, {
          id: issue.seriesId,
        });
        if (s) {
          series = s;
          seriesCache.set(issue.seriesId, s);
        }
      }

      articles.push({
        issueId: issue._id,
        title: issue.title,
        author: issue.author ?? null,
        seriesName: series?.name ?? "Unknown",
        contentHtml: issue.cleanContent ?? "<p>Content unavailable.</p>",
        summary: issue.summary ?? null,
        issueDate: issue.issueDate
          ? new Date(issue.issueDate).toISOString().split("T")[0]
          : null,
      });
    }

    // 3. Check if magazine already exists for this month
    const existing: Doc<"magazines"> | null = await ctx.runQuery(
      internal.magazineHelpers.getByMonth,
      { month: args.month }
    );

    // 4. Determine issue number by chronological month order (#1 = earliest
    // month). For an existing magazine keep its current number here; for a new
    // month, its rank = how many existing magazine months are earlier + 1. Either
    // way, renumberByMonth is run at the end to keep the whole sequence in order
    // (so a backfilled earlier month bumps later months correctly).
    let issueNumber: number;
    if (existing) {
      issueNumber = existing.issueNumber;
    } else {
      const months: string[] = await ctx.runQuery(
        internal.magazineHelpers.allMonths
      );
      issueNumber = months.filter((m) => m < args.month).length + 1;
    }

    // 5. Format title
    const date = new Date(args.month + "-01");
    const monthLabel = date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
    });
    const title = `ShelfRead Magazine — Issue #${issueNumber}, ${monthLabel}`;

    // 6. Generate EPUB
    console.log(
      `Building magazine: ${title} (${articles.length} articles)`
    );

    const epubBuffer = await generateMagazineEpub({
      title,
      issueNumber,
      month: args.month,
      articles,
    });

    // 7. Store EPUB (delete old one if updating)
    const blob = new Blob([epubBuffer], { type: "application/epub+zip" });
    const epubFileId = await ctx.storage.store(blob);

    // 8. Create or update magazine record
    const articleIds = articles.map(
      (a) => a.issueId
    ) as Id<"issues">[];

    if (existing) {
      // Best-effort delete of the old EPUB; a missing blob must not abort.
      if (existing.epubFileId) {
        await deleteStorageSafe(ctx, existing.epubFileId);
      }
      await ctx.runMutation(internal.magazineHelpers.update, {
        id: existing._id,
        title,
        articleCount: articles.length,
        articleIds,
        epubFileId,
        epubSizeBytes: epubBuffer.length,
        updatedAt: Date.now(),
      });
      console.log(`Updated magazine ${title}`);
    } else {
      await ctx.runMutation(internal.magazineHelpers.create, {
        month: args.month,
        issueNumber,
        title,
        articleCount: articles.length,
        articleIds,
        epubFileId,
        epubSizeBytes: epubBuffer.length,
      });
      console.log(`Created magazine ${title}`);
    }

    // Keep issue numbers in chronological month order. A backfilled earlier
    // month bumps later months here (DB title + number). Note: a bumped
    // magazine's already-generated EPUB still shows its old number on its title
    // page until that month is itself rebuilt — the OPDS feed uses the DB title,
    // so what the reader browses is always correct.
    await ctx.runMutation(internal.magazineHelpers.renumberByMonth, {});
  },
});
