import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

/**
 * Ingest a fully-rendered article with HTML content and metadata.
 * Designed for browser extensions (like SnapRoute) that already have
 * the page content — no server-side fetch needed.
 *
 * POST /ingest-article
 * Body: {
 *   url: string,          // source URL
 *   title?: string,       // page title (falls back to og:title extraction)
 *   html: string,         // full page HTML
 * }
 */
export const receiveArticle = httpAction(async (ctx, request) => {
  try {
    // Auth: check ingest key if configured
    const ingestKey = process.env.SHELF_INGEST_KEY;
    if (ingestKey) {
      const providedKey = request.headers.get("X-Shelf-Ingest-Key");
      if (providedKey !== ingestKey) {
        return jsonResponse({ error: "Unauthorized" }, 401);
      }
    }

    const body = await request.json();
    const url: string | undefined = body.url;
    const html: string | undefined = body.html;
    const providedTitle: string | undefined = body.title;

    if (!html) {
      return jsonResponse({ error: "Missing required field: html" }, 400);
    }

    if (!url) {
      return jsonResponse({ error: "Missing required field: url" }, 400);
    }

    if (html.length < 100) {
      return jsonResponse({ error: "HTML content too short" }, 400);
    }

    // Parse URL for series grouping
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return jsonResponse({ error: "Invalid URL" }, 400);
    }

    // Extract title from HTML if not provided
    let title = providedTitle;
    if (!title) {
      const ogTitleMatch = html.match(
        /<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i
      );
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      title = ogTitleMatch?.[1] || titleMatch?.[1]?.trim() || parsed.hostname;
    }

    // Use the URL's hostname as the sender (creates a series per domain)
    const senderEmail = `web@${parsed.hostname}`;
    const senderName = parsed.hostname;

    // Store raw HTML
    const blob = new Blob([html], { type: "text/html" });
    const rawHtmlStorageId = await ctx.storage.store(blob);

    // Match or create series
    let series = await ctx.runQuery(internal.series.findByEmail, {
      senderEmail,
    });

    if (!series) {
      const seriesId = await ctx.runMutation(internal.series.createSeries, {
        name: senderName,
        senderEmail,
        senderName,
      });
      series = { _id: seriesId } as { _id: typeof seriesId };
    }

    // Duplicate detection
    const isDuplicate = await ctx.runQuery(internal.issues.checkDuplicate, {
      seriesId: series._id,
      title,
    });
    if (isDuplicate) {
      return jsonResponse({ ok: true, duplicate: true }, 200);
    }

    // Create issue
    const issueId = await ctx.runMutation(internal.issues.create, {
      seriesId: series._id,
      title,
      rawHtmlStorageId,
      receivedAt: Date.now(),
    });

    // Schedule processing (Gemini extraction + EPUB generation)
    await ctx.scheduler.runAfter(0, internal.process.processEmail, {
      issueId,
    });

    return jsonResponse({ ok: true, issueId, title }, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Article ingest error:", message);
    return jsonResponse({ error: message }, 500);
  }
});

function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
