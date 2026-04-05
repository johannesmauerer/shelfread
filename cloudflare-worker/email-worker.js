// Cloudflare Email Worker for ShelfRead
// Receives incoming emails and forwards them to the Convex ingest endpoint.
//
// Environment variables (set in Cloudflare dashboard):
//   SHELF_INGEST_URL  - e.g. https://your-deployment.convex.site/ingest
//   SHELF_INGEST_KEY  - shared secret for authentication (optional)

import PostalMime from "postal-mime";

export default {
  async email(message, env, ctx) {
    try {
      const rawEmail = await new Response(message.raw).arrayBuffer();

      const parser = new PostalMime();
      const parsed = await parser.parse(rawEmail);

      const htmlBody = parsed.html || parsed.text || "";
      const subject =
        parsed.subject || message.headers.get("subject") || "(no subject)";

      // Try to find the original sender for forwarded emails
      let originalFrom = null;
      try {
        originalFrom = findOriginalSender(parsed, message);
      } catch (e) {
        console.error("findOriginalSender error:", e);
      }

      const headers = { "Content-Type": "application/json" };
      if (env.SHELF_INGEST_KEY) {
        headers["X-Shelf-Ingest-Key"] = env.SHELF_INGEST_KEY;
      }

      const response = await fetch(env.SHELF_INGEST_URL, {
        method: "POST",
        headers,
        body: JSON.stringify({
          from: originalFrom || message.from,
          forwardedBy: message.from,
          subject,
          htmlBody,
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        console.error(`Ingest failed (${response.status}): ${text}`);
      }
    } catch (e) {
      console.error("Email worker error:", e);
    }
  },
};

function findOriginalSender(parsed, message) {
  // 1. Check common forwarding headers
  const headerChecks = [
    "x-original-sender",
    "x-original-from",
    "x-forwarded-from",
    "reply-to",
  ];

  const headers = parsed.headers || [];
  if (Array.isArray(headers)) {
    for (const h of headerChecks) {
      const found = headers.find((hdr) => hdr.key.toLowerCase() === h);
      if (found && found.value && found.value !== message.from) {
        return found.value;
      }
    }
  }

  // 2. Look for "From:" in the forwarded email body (plain text part)
  const text = parsed.text || "";
  const fromMatch = text.match(
    /^From:\s*(.+<[^>]+>|[^\s@]+@[^\s@]+\.[^\s@]+)/m
  );
  if (fromMatch) {
    const extracted = fromMatch[1].trim();
    if (extracted !== message.from) {
      return extracted;
    }
  }

  // 3. Look in the HTML body too
  const html = parsed.html || "";
  const htmlFromMatch = html.match(
    /From:<\/\w*>\s*([^<]+&lt;[^&]+&gt;)/i
  );
  if (htmlFromMatch) {
    const decoded = htmlFromMatch[1]
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .trim();
    if (decoded !== message.from) {
      return decoded;
    }
  }

  return null;
}
