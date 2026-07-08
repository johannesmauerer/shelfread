import { v } from "convex/values";
import {
  query,
  mutation,
  internalMutation,
  internalQuery,
} from "./_generated/server";

export const create = internalMutation({
  args: {
    seriesId: v.id("series"),
    title: v.string(),
    rawHtmlStorageId: v.id("_storage"),
    receivedAt: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("issues", {
      seriesId: args.seriesId,
      title: args.title,
      rawHtmlStorageId: args.rawHtmlStorageId,
      receivedAt: args.receivedAt,
      status: "pending",
      retryCount: 0,
    });
  },
});

export const updateStatus = internalMutation({
  args: {
    id: v.id("issues"),
    status: v.union(
      v.literal("pending"),
      v.literal("extracting"),
      v.literal("generating"),
      v.literal("ready"),
      v.literal("failed")
    ),
    cleanContent: v.optional(v.string()),
    summary: v.optional(v.string()),
    title: v.optional(v.string()),
    author: v.optional(v.string()),
    issueDate: v.optional(v.number()),
    epubFileId: v.optional(v.id("_storage")),
    epubSizeBytes: v.optional(v.number()),
    error: v.optional(v.string()),
    retryCount: v.optional(v.number()),
    seriesId: v.optional(v.id("series")),
    retentionRatio: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    // Filter out undefined values
    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        patch[key] = value;
      }
    }
    await ctx.db.patch(id, patch);
  },
});

export const get = internalQuery({
  args: { id: v.id("issues") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const listRecent = query({
  args: {},
  handler: async (ctx) => {
    const issues = await ctx.db
      .query("issues")
      .withIndex("by_received")
      .order("desc")
      .take(100);

    // Join with series data
    return Promise.all(
      issues.map(async (issue) => {
        const series = await ctx.db.get(issue.seriesId);
        return {
          ...issue,
          seriesName: series?.name ?? "Unknown",
          seriesSlug: series?.slug ?? "unknown",
        };
      })
    );
  },
});

export const stats = query({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("issues").collect();
    const counts = { pending: 0, extracting: 0, generating: 0, ready: 0, failed: 0 };
    for (const issue of all) {
      counts[issue.status]++;
    }
    return { total: all.length, ...counts };
  },
});

export const listBySeries = internalQuery({
  args: { seriesId: v.id("series") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("issues")
      .withIndex("by_series", (q) => q.eq("seriesId", args.seriesId))
      .order("desc")
      .collect();
  },
});

export const listRecentInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("issues")
      .withIndex("by_received")
      .order("desc")
      .take(50);
  },
});

export const listFailedInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("issues").collect();
    return all.filter((i) => i.status === "failed").map((i) => i._id);
  },
});

// All issue IDs whose publication month is `month` ("YYYY-MM"). Uses issueDate
// when present, otherwise falls back to receivedAt, matching how the magazine
// rebuild buckets issues by month.
export const listByMonth = internalQuery({
  args: { month: v.string() },
  handler: async (ctx, args) => {
    const all = await ctx.db.query("issues").collect();
    return all
      .filter((i) => {
        const ts = i.receivedAt; // bucket by received date (matches magazine bucketing)
        const d = new Date(ts);
        const m = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
        return m === args.month;
      })
      .map((i) => i._id);
  },
});

// Status + retention for every issue in a month — operational visibility for
// monitoring a batch reprocess and spotting low-retention extractions.
export const listByMonthStatus = query({
  args: { month: v.string() },
  handler: async (ctx, args) => {
    const all = await ctx.db.query("issues").collect();
    return all
      .filter((i) => {
        const ts = i.receivedAt; // bucket by received date (matches magazine bucketing)
        const d = new Date(ts);
        const m = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
        return m === args.month;
      })
      .map((i) => ({
        id: i._id,
        title: i.title,
        status: i.status,
        retentionRatio: i.retentionRatio,
        cleanChars: (i.cleanContent ?? "").length,
      }));
  },
});

export const deleteIssue = mutation({
  args: { id: v.id("issues") },
  handler: async (ctx, args) => {
    const issue = await ctx.db.get(args.id);
    if (!issue) return { deleted: false };
    if (issue.epubFileId) await ctx.storage.delete(issue.epubFileId);
    if (issue.rawHtmlStorageId) await ctx.storage.delete(issue.rawHtmlStorageId);
    await ctx.db.delete(args.id);
    return { deleted: true };
  },
});

export const deleteSeries = mutation({
  args: { id: v.id("series") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
    return { deleted: true };
  },
});

export const checkDuplicate = internalQuery({
  args: {
    seriesId: v.id("series"),
    title: v.string(),
  },
  handler: async (ctx, args) => {
    const oneHourAgo = Date.now() - 3600000;
    const issues = await ctx.db
      .query("issues")
      .withIndex("by_series", (q) => q.eq("seriesId", args.seriesId))
      .order("desc")
      .take(20);

    return issues.some(
      (issue) => issue.title === args.title && issue.receivedAt > oneHourAgo
    );
  },
});
