// Cloudflare Email Worker for Shelf
// Receives incoming emails and forwards them to the Convex ingest endpoint.
//
// Environment variables (set in Cloudflare dashboard):
//   SHELF_INGEST_URL  - e.g. https://colorful-quail-252.convex.site/ingest
//   SHELF_INGEST_KEY  - shared secret for authentication (optional)

import PostalMime from "postal-mime";

export default {
  async email(message, env, ctx) {
    // Read the raw email
    const rawEmail = await new Response(message.raw).arrayBuffer();

    // Parse MIME to extract HTML body
    const parser = new PostalMime();
    const parsed = await parser.parse(rawEmail);

    const htmlBody = parsed.html || parsed.text || "";
    const subject = parsed.subject || message.headers.get("subject") || "(no subject)";

    // POST to Convex ingest endpoint
    const headers = { "Content-Type": "application/json" };
    if (env.SHELF_INGEST_KEY) {
      headers["X-Shelf-Ingest-Key"] = env.SHELF_INGEST_KEY;
    }

    const response = await fetch(env.SHELF_INGEST_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({
        from: message.from,
        subject,
        htmlBody,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`Ingest failed (${response.status}): ${text}`);
    }
  },
};
