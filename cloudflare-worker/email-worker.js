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

      // Collect every recipient-ish address so the ingest allowlist can accept
      // auto-forwarded mail (e.g. Gmail forwarding a Substack newsletter): the
      // original From is the newsletter, not the user, but the user's address is
      // still in To/Cc/Delivered-To/X-Forwarded-To.
      const recipients = collectRecipients(parsed, message);

      const response = await fetch(env.SHELF_INGEST_URL, {
        method: "POST",
        headers,
        body: JSON.stringify({
          from: originalFrom || message.from,
          forwardedBy: message.from,
          recipients,
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

// Gather every address the message was directed to, from both the parsed
// structured fields and raw headers. Returns a deduped list of lowercased
// email addresses. Used by the ingest allowlist to accept auto-forwarded mail.
function collectRecipients(parsed, message) {
  const found = new Set();

  const addAddr = (addr) => {
    if (!addr) return;
    // addr may be "Name <x@y.com>" or "x@y.com"; pull the address part.
    const m = String(addr).match(/<([^>]+)>/);
    const email = (m ? m[1] : addr).trim().toLowerCase();
    if (email.includes("@")) found.add(email);
  };

  // 1. PostalMime structured recipient fields (arrays of {address, name}).
  for (const field of ["to", "cc", "bcc", "deliveredTo"]) {
    const val = parsed && parsed[field];
    if (Array.isArray(val)) {
      for (const entry of val) addAddr(entry && (entry.address || entry));
    } else if (val) {
      addAddr(val.address || val);
    }
  }

  // 2. Cloudflare envelope recipient.
  if (message && message.to) addAddr(message.to);

  // 3. Raw headers that carry recipients through forwarding hops.
  const recipientHeaders = [
    "to",
    "cc",
    "delivered-to",
    "x-forwarded-to",
    "x-original-to",
    "envelope-to",
  ];
  const headers = (parsed && parsed.headers) || [];
  if (Array.isArray(headers)) {
    for (const hdr of headers) {
      if (hdr && recipientHeaders.includes(String(hdr.key).toLowerCase())) {
        // A header value may list multiple comma-separated addresses.
        for (const part of String(hdr.value).split(",")) addAddr(part);
      }
    }
  }

  return Array.from(found);
}

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
