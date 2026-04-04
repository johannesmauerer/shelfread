import { v } from "convex/values";
import { query, mutation, internalMutation, internalQuery } from "./_generated/server";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export const findByEmail = internalQuery({
  args: { senderEmail: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("series")
      .withIndex("by_sender", (q) => q.eq("senderEmail", args.senderEmail))
      .first();
  },
});

export const findBySlug = internalQuery({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("series")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();
  },
});

export const createSeries = internalMutation({
  args: {
    name: v.string(),
    senderEmail: v.string(),
    senderName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const slug = slugify(args.name);
    // Ensure slug uniqueness by appending a counter if needed
    let finalSlug = slug;
    let counter = 1;
    while (
      await ctx.db
        .query("series")
        .withIndex("by_slug", (q) => q.eq("slug", finalSlug))
        .first()
    ) {
      finalSlug = `${slug}-${counter}`;
      counter++;
    }

    return await ctx.db.insert("series", {
      name: args.name,
      senderEmail: args.senderEmail,
      senderName: args.senderName,
      slug: finalSlug,
      issueCount: 0,
      designAnalyzed: false,
      createdAt: Date.now(),
    });
  },
});

export const incrementIssueCount = internalMutation({
  args: { seriesId: v.id("series") },
  handler: async (ctx, args) => {
    const series = await ctx.db.get(args.seriesId);
    if (!series) return;
    await ctx.db.patch(args.seriesId, {
      issueCount: series.issueCount + 1,
      lastIssueDate: Date.now(),
    });
  },
});

export const listInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("series").collect();
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("series").collect();
  },
});

export const get = query({
  args: { id: v.id("series") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const getInternal = internalQuery({
  args: { id: v.id("series") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const updateName = internalMutation({
  args: { id: v.id("series"), name: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { name: args.name });
  },
});

export const updateDesign = internalMutation({
  args: {
    id: v.id("series"),
    colorPrimary: v.string(),
    colorSecondary: v.string(),
    colorAccent: v.string(),
    fontMood: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      colorPrimary: args.colorPrimary,
      colorSecondary: args.colorSecondary,
      colorAccent: args.colorAccent,
      fontMood: args.fontMood,
      designAnalyzed: true,
    });
  },
});

export const rename = mutation({
  args: { id: v.id("series"), name: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { name: args.name });
  },
});
