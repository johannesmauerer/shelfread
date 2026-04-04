"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { extractContent, analyzeDesign } from "./lib/gemini";
import { generateEpub } from "./lib/epub";
import { generateSeriesCSS } from "./lib/css";

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

      // 9. Update series issue count
      await ctx.runMutation(internal.series.incrementIssueCount, {
        seriesId: issue.seriesId,
      });

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
