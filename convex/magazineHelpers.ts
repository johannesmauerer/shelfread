import { v } from "convex/values";
import {
  query,
  mutation,
  internalQuery,
  internalMutation,
} from "./_generated/server";
import { internal } from "./_generated/api";

// --- Internal queries ---

export const getByMonth = internalQuery({
  args: { month: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("magazines")
      .withIndex("by_month", (q) => q.eq("month", args.month))
      .first();
  },
});

export const getById = internalQuery({
  args: { id: v.id("magazines") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const getIssuesByIds = internalQuery({
  args: { ids: v.array(v.id("issues")) },
  handler: async (ctx, args) => {
    const issues = await Promise.all(args.ids.map((id) => ctx.db.get(id)));
    return issues.filter((i): i is NonNullable<typeof i> => i !== null);
  },
});

export const countAll = internalQuery({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("magazines").collect();
    return all.length;
  },
});

export const allMonths = internalQuery({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("magazines").collect();
    return all.map((m) => m.month);
  },
});

function monthLabel(month: string): string {
  const date = new Date(month + "-01");
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short" });
}

// Reassign every magazine's issueNumber (and its title, which embeds the number)
// so numbers run in chronological month order: #1 = earliest month … #N =
// latest. Idempotent. Called after a rebuild so a backfilled earlier month
// doesn't leave the sequence out of order. Returns the resulting numbering.
export const renumberByMonth = internalMutation({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("magazines").collect();
    all.sort((a, b) => a.month.localeCompare(b.month));
    const result: { month: string; issueNumber: number }[] = [];
    for (let i = 0; i < all.length; i++) {
      const mag = all[i];
      const issueNumber = i + 1;
      const title = `ShelfRead Magazine — Issue #${issueNumber}, ${monthLabel(mag.month)}`;
      if (mag.issueNumber !== issueNumber || mag.title !== title) {
        await ctx.db.patch(mag._id, { issueNumber, title });
      }
      result.push({ month: mag.month, issueNumber });
    }
    return result;
  },
});

// Public wrapper so the renumber can be triggered from the CLI / dashboard.
export const renumberByMonthPublic = mutation({
  args: {},
  handler: async (ctx): Promise<{ month: string; issueNumber: number }[]> => {
    return await ctx.runMutation(internal.magazineHelpers.renumberByMonth, {});
  },
});

/**
 * Get all "ready" issues RECEIVED in a given month (by receivedAt).
 */
export const listReadyIssuesByMonth = internalQuery({
  args: { month: v.string() },
  handler: async (ctx, args) => {
    // Parse month boundaries
    const startDate = new Date(args.month + "-01T00:00:00Z");
    const endYear =
      startDate.getUTCMonth() === 11
        ? startDate.getUTCFullYear() + 1
        : startDate.getUTCFullYear();
    const endMonth =
      startDate.getUTCMonth() === 11 ? 0 : startDate.getUTCMonth() + 1;
    const endDate = new Date(
      Date.UTC(endYear, endMonth, 1)
    );

    const startMs = startDate.getTime();
    const endMs = endDate.getTime();

    // Query all ready issues and filter by date range
    // We use receivedAt index since that's what we have
    const issues = await ctx.db
      .query("issues")
      .withIndex("by_received")
      .order("asc")
      .collect();

    return issues.filter((issue) => {
      if (issue.status !== "ready") return false;
      // Bucket by when Shelfread RECEIVED the issue, not the newsletter's
      // publication date. A June-published newsletter forwarded in July belongs
      // in the July magazine — that's when the reader got it. Using receivedAt
      // also sidesteps garbage extracted issueDates (e.g. a misread "2025-06").
      const ts = issue.receivedAt;
      return ts >= startMs && ts < endMs;
    });
  },
});

// --- Internal mutations ---

export const create = internalMutation({
  args: {
    month: v.string(),
    issueNumber: v.number(),
    title: v.string(),
    articleCount: v.number(),
    articleIds: v.array(v.id("issues")),
    epubFileId: v.id("_storage"),
    epubSizeBytes: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("magazines", {
      month: args.month,
      issueNumber: args.issueNumber,
      title: args.title,
      articleCount: args.articleCount,
      articleIds: args.articleIds,
      epubFileId: args.epubFileId,
      epubSizeBytes: args.epubSizeBytes,
      updatedAt: Date.now(),
      createdAt: Date.now(),
    });
  },
});

export const update = internalMutation({
  args: {
    id: v.id("magazines"),
    title: v.string(),
    articleCount: v.number(),
    articleIds: v.array(v.id("issues")),
    epubFileId: v.id("_storage"),
    epubSizeBytes: v.number(),
    updatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const { id, ...patch } = args;
    await ctx.db.patch(id, patch);
  },
});

// Delete a magazine row and free its EPUB blob. Used to remove duplicate/orphan
// magazine records (the rebuild path can leave a stale row for a month). The
// blob delete is best-effort so a missing/already-gone blob doesn't block the
// row removal.
export const deleteMagazine = mutation({
  args: { id: v.id("magazines") },
  handler: async (ctx, args) => {
    const mag = await ctx.db.get(args.id);
    if (!mag) return { deleted: false, reason: "not found" };
    if (mag.epubFileId) {
      try {
        await ctx.storage.delete(mag.epubFileId);
      } catch (err) {
        console.warn(`deleteMagazine: blob ${mag.epubFileId} already gone:`, err);
      }
    }
    await ctx.db.delete(args.id);
    return { deleted: true, month: mag.month, issueNumber: mag.issueNumber };
  },
});

// --- Public queries (for dashboard) ---

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("magazines")
      .withIndex("by_issueNumber")
      .order("desc")
      .take(50);
  },
});

export const listInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("magazines")
      .withIndex("by_issueNumber")
      .order("desc")
      .take(50);
  },
});
