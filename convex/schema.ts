import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  series: defineTable({
    name: v.string(),
    senderEmail: v.string(),
    senderName: v.optional(v.string()),
    slug: v.string(),
    issueCount: v.number(),
    lastIssueDate: v.optional(v.number()),

    // Design echo
    colorPrimary: v.optional(v.string()),
    colorSecondary: v.optional(v.string()),
    colorAccent: v.optional(v.string()),
    fontMood: v.optional(v.string()),
    cssOverride: v.optional(v.string()),
    coverImageId: v.optional(v.id("_storage")),

    designAnalyzed: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_sender", ["senderEmail"])
    .index("by_slug", ["slug"]),

  issues: defineTable({
    seriesId: v.id("series"),
    title: v.string(),
    author: v.optional(v.string()),
    issueDate: v.optional(v.number()),
    receivedAt: v.number(),

    // Content
    rawHtmlStorageId: v.id("_storage"),
    cleanContent: v.optional(v.string()),
    summary: v.optional(v.string()),

    // EPUB
    epubFileId: v.optional(v.id("_storage")),
    epubSizeBytes: v.optional(v.number()),

    // Processing
    status: v.union(
      v.literal("pending"),
      v.literal("extracting"),
      v.literal("generating"),
      v.literal("ready"),
      v.literal("failed")
    ),
    error: v.optional(v.string()),
    retryCount: v.number(),
  })
    .index("by_series", ["seriesId", "issueDate"])
    .index("by_status", ["status"])
    .index("by_received", ["receivedAt"]),

  magazines: defineTable({
    month: v.string(), // "2026-04" format
    issueNumber: v.number(), // Sequential: 1, 2, 3...
    title: v.string(), // "ShelfRead Magazine — Issue #1, Apr 2026"
    articleCount: v.number(),
    articleIds: v.array(v.id("issues")),
    epubFileId: v.optional(v.id("_storage")),
    epubSizeBytes: v.optional(v.number()),
    updatedAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_month", ["month"])
    .index("by_issueNumber", ["issueNumber"]),

  settings: defineTable({
    key: v.string(),
    value: v.string(),
  }).index("by_key", ["key"]),
});
