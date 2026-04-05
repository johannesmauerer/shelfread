import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

interface ParsedEmail {
  from: string;
  forwardedBy?: string;
  subject: string;
  htmlBody: string;
}

// Parse the request body — supports JSON (dashboard/worker) and multipart/form-data (Mailgun)
async function parseRequest(request: Request): Promise<ParsedEmail> {
  const contentType = request.headers.get("Content-Type") || "";

  if (contentType.includes("application/json")) {
    const body = await request.json();
    return {
      from: body.from || "",
      forwardedBy: body.forwardedBy || undefined,
      subject: body.subject || "",
      htmlBody: body.htmlBody || body.textBody || "",
    };
  }

  if (
    contentType.includes("multipart/form-data") ||
    contentType.includes("application/x-www-form-urlencoded")
  ) {
    // Mailgun inbound webhook format
    const formData = await request.formData();
    return {
      from: (formData.get("from") as string) || (formData.get("sender") as string) || "",
      subject: (formData.get("subject") as string) || "",
      htmlBody:
        (formData.get("body-html") as string) ||
        (formData.get("stripped-html") as string) ||
        (formData.get("body-plain") as string) ||
        "",
    };
  }

  throw new Error(`Unsupported Content-Type: ${contentType}`);
}

export const receiveEmail = httpAction(async (ctx, request) => {
  try {
    const parsed = await parseRequest(request);

    if (!parsed.from || !parsed.subject) {
      return jsonResponse({ error: "Missing required fields: from, subject" }, 400);
    }
    if (!parsed.htmlBody) {
      return jsonResponse({ error: "Missing email body" }, 400);
    }

    const senderEmail = extractEmail(parsed.from);
    const senderName = extractName(parsed.from);

    // Check ingest key for webhook requests
    const ingestKey = process.env.SHELF_INGEST_KEY;
    if (ingestKey) {
      const providedKey = request.headers.get("X-Shelf-Ingest-Key");
      if (providedKey !== ingestKey) {
        const contentType = request.headers.get("Content-Type") || "";
        if (!contentType.includes("application/json")) {
          return jsonResponse({ error: "Unauthorized" }, 401);
        }
      }
    }

    // Check sender allowlist — check both the original sender and the forwarder
    const allowedSendersStr = await ctx.runQuery(internal.settings.get, {
      key: "allowed_senders",
    });
    if (allowedSendersStr) {
      const allowedSenders: string[] = JSON.parse(allowedSendersStr);
      if (allowedSenders.length > 0) {
        const forwarderEmail = parsed.forwardedBy
          ? extractEmail(parsed.forwardedBy)
          : null;
        const isAllowed =
          allowedSenders.includes(senderEmail) ||
          (forwarderEmail && allowedSenders.includes(forwarderEmail));
        if (!isAllowed) {
          console.log(`Rejected email from non-allowlisted sender: ${senderEmail}`);
          return jsonResponse({ ok: true }, 200);
        }
      }
    }

    // Store raw HTML in file storage
    const blob = new Blob([parsed.htmlBody], { type: "text/html" });
    const rawHtmlStorageId = await ctx.storage.store(blob);

    // Match or create series based on sender email
    let series = await ctx.runQuery(internal.series.findByEmail, {
      senderEmail,
    });

    if (!series) {
      const seriesId = await ctx.runMutation(internal.series.createSeries, {
        name: senderName || senderEmail,
        senderEmail,
        senderName: senderName || undefined,
      });
      series = { _id: seriesId } as { _id: typeof seriesId };
    }

    // Duplicate detection — skip if same title exists in this series within 1 hour
    const isDuplicate = await ctx.runQuery(internal.issues.checkDuplicate, {
      seriesId: series._id,
      title: parsed.subject,
    });
    if (isDuplicate) {
      console.log(`Skipping duplicate: "${parsed.subject}" in series ${series._id}`);
      return jsonResponse({ ok: true, duplicate: true }, 200);
    }

    // Create issue record
    const issueId = await ctx.runMutation(internal.issues.create, {
      seriesId: series._id,
      title: parsed.subject,
      rawHtmlStorageId,
      receivedAt: Date.now(),
    });

    // Schedule processing
    await ctx.scheduler.runAfter(0, internal.process.processEmail, {
      issueId,
    });

    return jsonResponse({ ok: true, issueId }, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Ingest error:", message);
    return jsonResponse({ error: message }, 500);
  }
});

function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function extractEmail(from: string): string {
  const match = from.match(/<([^>]+)>/);
  return match ? match[1] : from.trim();
}

function extractName(from: string): string | null {
  const match = from.match(/^([^<]+)</);
  return match ? match[1].trim() : null;
}
