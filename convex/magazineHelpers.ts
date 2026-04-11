import { v } from "convex/values";
import {
  query,
  internalQuery,
  internalMutation,
} from "./_generated/server";

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

export const countAll = internalQuery({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("magazines").collect();
    return all.length;
  },
});

/**
 * Get all "ready" issues whose issueDate (or receivedAt) falls in a given month.
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
      // Use issueDate if available, otherwise receivedAt
      const ts = issue.issueDate ?? issue.receivedAt;
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
