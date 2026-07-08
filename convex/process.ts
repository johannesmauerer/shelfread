"use node";

import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { extractContent, analyzeDesign } from "./lib/gemini";
import { generateEpub } from "./lib/epub";
import { generateSeriesCSS } from "./lib/css";

// Chrome that legitimately appears in the source but is NOT article content.
// Used to keep the retention denominator honest — otherwise footers and legal
// boilerplate count as "dropped content" and every issue looks truncated.
const CHROME_PATTERN =
  /forwarded message|unsubscribe|view (this|in) (your )?browser|privacy policy|terms of service|all rights reserved|affiliate|ethics policy|copyright|sent to you in error|update your preferences/i;

function visibleText(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, "")
    .replace(/<head\b[\s\S]*?<\/head>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Fraction of the source's *content* words preserved in the extracted body.
 * Splits the source into sentence-ish units, drops obvious chrome, and measures
 * how many survive into cleanContent. ~1.0 means a faithful extraction; a low
 * value flags a likely truncation. Used two ways in processEmail: a hard gate
 * (<0.35 throws → retry, so catastrophic failures never ship) and a soft
 * warning (<0.6 logs). The verbatim prompt is the actual fix; this is the
 * tripwire that catches regressions instead of silently shipping half an
 * article (the original bug).
 */
function computeRetention(rawHtml: string, cleanHtml: string): number {
  const srcSentences = visibleText(rawHtml)
    .split(/(?<=[.!?”"])\s+/)
    .filter((s) => s.trim().length > 25 && !CHROME_PATTERN.test(s));
  const srcWords = srcSentences.join(" ").split(/\s+/).filter(Boolean).length;
  if (srcWords < 50) return 1; // too little source content to judge meaningfully
  const cleanWords = visibleText(cleanHtml).split(/\s+/).filter(Boolean).length;
  return Math.min(1, cleanWords / srcWords);
}

export const processEmail = internalAction({
  args: { issueId: v.id("issues") },
  handler: async (ctx, args) => {
    const issue = await ctx.runQuery(internal.issues.get, { id: args.issueId });
    if (!issue) {
      console.error(`Issue ${args.issueId} not found`);
      return;
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      await ctx.runMutation(internal.issues.updateStatus, {
        id: args.issueId,
        status: "failed",
        error: "GEMINI_API_KEY not configured",
      });
      return;
    }

    try {
      // 1. Get raw HTML from storage
      const htmlBlob = await ctx.storage.get(issue.rawHtmlStorageId);
      if (!htmlBlob) {
        throw new Error("Raw HTML not found in storage");
      }
      const htmlBody = await htmlBlob.text();

      // 2. Extract content via Gemini
      await ctx.runMutation(internal.issues.updateStatus, {
        id: args.issueId,
        status: "extracting",
      });

      const extracted = await extractContent(htmlBody, apiKey);

      // Guard: never mark an issue "ready" with empty body content. If extraction
      // returns no usable content_html, throw so the catch block records a real
      // failure and schedules a retry — instead of silently producing an empty
      // EPUB and a "Content unavailable." magazine entry.
      const extractedContent = (extracted.content_html ?? "").trim();
      if (extractedContent.length < 50) {
        throw new Error(
          `Extraction returned empty content_html (${extractedContent.length} chars) for "${extracted.title ?? issue.title}"`
        );
      }

      // Retention gate: how much of the source content survived extraction.
      // The empty-guard above only catches a TOTALLY empty body. The real bug
      // was *partial* bodies that look fine — and extraction can still fail
      // catastrophically (e.g. the model returns a fragment + a chatbot
      // "would you like me to summarize?" reply). Throw on a catastrophically
      // low ratio so the issue RETRIES instead of shipping half an article.
      // Threshold is conservative (only true failures, not legitimately short
      // posts); borderline cases pass but get a logged warning below.
      const retentionRatio = computeRetention(htmlBody, extractedContent);
      if (retentionRatio < 0.35) {
        throw new Error(
          `Extraction retained only ${(retentionRatio * 100).toFixed(0)}% of source content for "${extracted.title ?? issue.title}" — likely truncated; retrying`
        );
      }
      if (retentionRatio < 0.6) {
        console.warn(
          `LOW RETENTION (${(retentionRatio * 100).toFixed(0)}%) for issue ${args.issueId} "${extracted.title}" — extraction may have dropped content`
        );
      }

      // 3. Resolve the correct series.
      // The ingest step assigns a series based on the envelope sender,
      // but for forwarded emails that's the forwarder's address, not the
      // newsletter's. Use the AI-extracted sender_email or publication_name
      // to find or create the right series.
      let series = await ctx.runQuery(internal.series.getInternal, {
        id: issue.seriesId,
      });

      const realSenderEmail = extracted.sender_email || series?.senderEmail || "";
      const publicationName = extracted.publication_name || series?.name || "";

      // If AI found a different sender than what the series has, re-match
      if (extracted.sender_email && series && extracted.sender_email !== series.senderEmail) {
        // Look for an existing series with the real sender
        const correctSeries = await ctx.runQuery(internal.series.findByEmail, {
          senderEmail: extracted.sender_email,
        });
        if (correctSeries) {
          // Re-assign this issue to the correct series
          series = correctSeries;
          await ctx.runMutation(internal.issues.updateStatus, {
            id: args.issueId,
            status: "extracting",
            seriesId: correctSeries._id,
          });
        } else {
          // Create a new series with the real sender
          const newSeriesId = await ctx.runMutation(internal.series.createSeries, {
            name: publicationName,
            senderEmail: extracted.sender_email,
          });
          series = await ctx.runQuery(internal.series.getInternal, { id: newSeriesId });
          await ctx.runMutation(internal.issues.updateStatus, {
            id: args.issueId,
            status: "extracting",
            seriesId: newSeriesId,
          });
        }
      } else if (series && series.name !== publicationName && publicationName) {
        // Same sender but better name from AI — update
        await ctx.runMutation(internal.series.updateName, {
          id: series._id,
          name: publicationName,
        });
      }

      const seriesName = series?.name ?? publicationName;

      // 4. Run design analysis if this series hasn't been analyzed yet
      let seriesCss: string | undefined;
      if (series && !series.designAnalyzed) {
        try {
          const design = await analyzeDesign(htmlBody, apiKey);
          await ctx.runMutation(internal.series.updateDesign, {
            id: series._id,
            colorPrimary: design.color_primary,
            colorSecondary: design.color_secondary,
            colorAccent: design.color_accent,
            fontMood: design.font_mood,
          });
          seriesCss = generateSeriesCSS(design);
          console.log(`Design analyzed for series "${seriesName}"`);
        } catch (designErr) {
          console.warn("Design analysis failed, using default CSS:", designErr);
        }
      } else if (series?.designAnalyzed && series.colorPrimary) {
        // Use existing design profile to generate CSS
        seriesCss = generateSeriesCSS({
          color_primary: series.colorPrimary,
          color_secondary: series.colorSecondary || "#f4f6f7",
          color_accent: series.colorAccent || "#e74c3c",
          font_mood: (series.fontMood as any) || "serif-formal",
          layout_style: "longform-essay",
          has_dividers: true,
          has_pullquotes: true,
          has_callout_boxes: true,
        });
      }

      // 5. Update issue with extracted metadata
      const issueDate = extracted.issue_date
        ? new Date(extracted.issue_date).getTime()
        : undefined;

      await ctx.runMutation(internal.issues.updateStatus, {
        id: args.issueId,
        status: "generating",
        title: extracted.title,
        author: extracted.author ?? undefined,
        cleanContent: extracted.content_html,
        summary: extracted.summary,
        issueDate,
        retentionRatio,
      });

      // 6. Generate EPUB with series-specific CSS
      const epubBuffer = await generateEpub({
        title: extracted.title || "Untitled",
        author: extracted.author,
        seriesName: extracted.publication_name || seriesName,
        contentHtml: extracted.content_html || "<p>Content extraction failed.</p>",
        summary: extracted.summary,
        issueDate: extracted.issue_date,
        css: seriesCss,
      });

      // 7. Store EPUB
      const blob = new Blob([epubBuffer], { type: "application/epub+zip" });
      const epubFileId = await ctx.storage.store(blob);

      // 8. Mark ready
      await ctx.runMutation(internal.issues.updateStatus, {
        id: args.issueId,
        status: "ready",
        epubFileId,
        epubSizeBytes: epubBuffer.length,
      });

      // Reprocessing replaces the EPUB but storage.store() never frees the old
      // blob. Delete the prior EPUB now that the new one is committed, so repeated
      // reprocessing doesn't leak ~MB-scale orphans into file storage.
      if (issue.epubFileId && issue.epubFileId !== epubFileId) {
        await ctx.storage.delete(issue.epubFileId);
      }

      // 9. Update series issue count
      await ctx.runMutation(internal.series.incrementIssueCount, {
        seriesId: issue.seriesId,
      });

      // 10. Rebuild monthly magazine — bucket by RECEIVED date (when Shelfread
      // got the issue), matching listReadyIssuesByMonth. Not the publication
      // date: a June newsletter forwarded in July belongs in July's magazine.
      const magazineDate = new Date(issue.receivedAt);
      const magazineMonth = `${magazineDate.getUTCFullYear()}-${String(magazineDate.getUTCMonth() + 1).padStart(2, "0")}`;
      await ctx.scheduler.runAfter(
        5000,
        internal.magazine.rebuildMagazine,
        { month: magazineMonth }
      );

      console.log(`Processed issue ${args.issueId}: "${extracted.title}"`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown error";
      console.error(`Failed to process issue ${args.issueId}:`, message);

      const retryCount = (issue.retryCount ?? 0) + 1;
      const maxRetries = 3;

      await ctx.runMutation(internal.issues.updateStatus, {
        id: args.issueId,
        status: "failed",
        error: message,
        retryCount,
      });

      if (retryCount < maxRetries) {
        const delayMs = [60000, 300000, 1800000][retryCount - 1] ?? 1800000;
        await ctx.scheduler.runAfter(delayMs, internal.process.processEmail, {
          issueId: args.issueId,
        });
        console.log(
          `Scheduled retry ${retryCount}/${maxRetries} in ${delayMs / 1000}s`
        );
      }
    }
  },
});

export const retryFailed = action({
  args: {},
  handler: async (ctx) => {
    const ids = await ctx.runQuery(internal.issues.listFailedInternal, {});
    for (const id of ids) {
      await ctx.runMutation(internal.issues.updateStatus, {
        id,
        status: "pending",
        retryCount: 0,
      });
      await ctx.scheduler.runAfter(0, internal.process.processEmail, {
        issueId: id,
      });
    }
    return { rescheduled: ids.length };
  },
});

// Re-run extraction + EPUB for a single existing issue, synchronously, and
// return the resulting retention + content length. Used to validate extraction
// changes against known issues and to repair individual articles.
export const reprocessOne = action({
  args: { id: v.id("issues") },
  handler: async (ctx, args): Promise<{
    id: string;
    title?: string;
    status?: string;
    retentionRatio?: number;
    cleanContentChars: number;
  }> => {
    await ctx.runMutation(internal.issues.updateStatus, {
      id: args.id,
      status: "pending",
      retryCount: 0,
    });
    // Await the pipeline directly (not via scheduler) so the result is ready to
    // read when this returns.
    await ctx.runAction(internal.process.processEmail, { issueId: args.id });
    const issue = await ctx.runQuery(internal.issues.get, { id: args.id });
    return {
      id: args.id,
      title: issue?.title,
      status: issue?.status,
      retentionRatio: issue?.retentionRatio,
      cleanContentChars: (issue?.cleanContent ?? "").length,
    };
  },
});

// Reset one issue to pending and schedule a single processEmail run (async,
// returns immediately). Used to reprocess issues one at a time, which avoids the
// concurrent-action stalls seen when many heavy Node actions run at once.
export const scheduleOne = action({
  args: { id: v.id("issues") },
  handler: async (ctx, args): Promise<{ id: string; scheduled: true }> => {
    await ctx.runMutation(internal.issues.updateStatus, {
      id: args.id,
      status: "pending",
      retryCount: 0,
    });
    await ctx.scheduler.runAfter(0, internal.process.processEmail, {
      issueId: args.id,
    });
    return { id: args.id, scheduled: true };
  },
});

// Re-run extraction + EPUB for every issue in a given month ("YYYY-MM" by
// issueDate; falls back to receivedAt when issueDate is missing). Schedules each
// through the normal pipeline, then rebuilds that month's magazine.
export const reprocessMonth = action({
  args: { month: v.string() },
  handler: async (ctx, args): Promise<{ month: string; scheduled: number; ids: string[] }> => {
    const ids = await ctx.runQuery(internal.issues.listByMonth, { month: args.month });
    for (const id of ids) {
      await ctx.runMutation(internal.issues.updateStatus, {
        id,
        status: "pending",
        retryCount: 0,
      });
      await ctx.scheduler.runAfter(0, internal.process.processEmail, { issueId: id });
    }
    return { month: args.month, scheduled: ids.length, ids };
  },
});
