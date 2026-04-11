import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

export const receiveUrl = httpAction(async (ctx, request) => {
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
    const url: string = body.url;

    if (!url) {
      return jsonResponse({ error: "Missing required field: url" }, 400);
    }

    // Validate URL
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return jsonResponse({ error: "Invalid URL" }, 400);
    }

    if (!parsed.protocol.startsWith("http")) {
      return jsonResponse({ error: "Only http/https URLs are supported" }, 400);
    }

    // Fetch the page
    const response = await fetch(url, {
      headers: {
        "User-Agent": "ShelfRead/1.0 (https://shelfread.xyz)",
        "Accept": "text/html,application/xhtml+xml,*/*",
      },
      redirect: "follow",
    });

    if (!response.ok) {
      return jsonResponse(
        { error: `Failed to fetch URL: ${response.status} ${response.statusText}` },
        502
      );
    }

    const html = await response.text();

    if (!html || html.length < 100) {
      return jsonResponse({ error: "Page returned empty or minimal content" }, 502);
    }

    // Extract title from HTML
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const ogTitleMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
    const title = ogTitleMatch?.[1] || titleMatch?.[1]?.trim() || parsed.hostname;

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

    // Schedule processing
    await ctx.scheduler.runAfter(0, internal.process.processEmail, {
      issueId,
    });

    return jsonResponse({ ok: true, issueId, title }, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("URL ingest error:", message);
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
