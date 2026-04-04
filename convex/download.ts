import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { verifySignedToken } from "./lib/signing";

// Signed download endpoint (used by OPDS feeds)
export const downloadSigned = httpAction(async (ctx, request) => {
  const url = new URL(request.url);
  // Path: /dl/{token}
  const tokenMatch = url.pathname.match(/^\/dl\/(.+)$/);
  if (!tokenMatch) {
    return new Response("Invalid download URL", { status: 400 });
  }

  const token = tokenMatch[1];
  const secret = process.env.DOWNLOAD_SECRET || "shelf-dev-secret";
  const { issueId, valid } = await verifySignedToken(token, secret);

  if (!valid) {
    return new Response("Download link expired or invalid", { status: 403 });
  }

  return serveEpub(ctx, issueId as Id<"issues">);
});

// Direct download endpoint (used by dashboard, no signing required for now)
export const downloadDirect = httpAction(async (ctx, request) => {
  const { searchParams } = new URL(request.url);
  const issueId = searchParams.get("id") as Id<"issues"> | null;

  if (!issueId) {
    return new Response(
      JSON.stringify({ error: "Missing id parameter" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  return serveEpub(ctx, issueId);
});

async function serveEpub(ctx: any, issueId: Id<"issues">): Promise<Response> {
  let issue;
  try {
    issue = await ctx.runQuery(internal.issues.get, { id: issueId });
  } catch {
    return new Response("Invalid issue ID", { status: 400 });
  }

  if (!issue) {
    return new Response("Issue not found", { status: 404 });
  }

  if (!issue.epubFileId) {
    return new Response("EPUB not yet generated", { status: 404 });
  }

  const blob = await ctx.storage.get(issue.epubFileId);
  if (!blob) {
    return new Response("EPUB file not found in storage", { status: 404 });
  }

  const filename = `${issue.title.replace(/[^a-zA-Z0-9\s-]/g, "").replace(/\s+/g, "-")}.epub`;

  return new Response(blob, {
    status: 200,
    headers: {
      "Content-Type": "application/epub+zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
