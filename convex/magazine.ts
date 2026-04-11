"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { generateMagazineEpub } from "./lib/epub";
import type { Doc, Id } from "./_generated/dataModel";

/**
 * Rebuild (or create) the magazine for a given month.
 * Called after each issue is marked "ready".
 */
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

    // 4. Determine issue number
    let issueNumber: number;
    if (existing) {
      issueNumber = existing.issueNumber;
    } else {
      const count: number = await ctx.runQuery(
        internal.magazineHelpers.countAll
      );
      issueNumber = count + 1;
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
      // Delete old EPUB file
      if (existing.epubFileId) {
        await ctx.storage.delete(existing.epubFileId);
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
  },
});
