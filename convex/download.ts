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

  // The signed token carries an id that is either an issue or a magazine. Try
  // issue first, then magazine; a 404 from one means "not that type, try the
  // other". Any non-404 (200 or 302 redirect) is the real response.
  const issueResult = await serveEpub(ctx, issueId as Id<"issues">);
  if (issueResult.status !== 404) {
    return issueResult;
  }
  const magazineResult = await serveMagazine(ctx, issueId as Id<"magazines">);
  if (magazineResult.status !== 404) {
    return magazineResult;
  }
  return new Response("Download not found", { status: 404 });
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

async function serveMagazine(ctx: any, magazineId: Id<"magazines">): Promise<Response> {
  let magazine;
  try {
    magazine = await ctx.runQuery(internal.magazineHelpers.getById, {
      id: magazineId,
    });
  } catch {
    return new Response("Magazine not found", { status: 404 });
  }

  if (!magazine || !magazine.epubFileId) {
    return new Response("Magazine not found", { status: 404 });
  }

  const filename = `${magazine.title.replace(/[^a-zA-Z0-9\s-]/g, "").replace(/\s+/g, "-")}.epub`;
  return serveStorageFile(ctx, magazine.epubFileId, filename);
}

async function serveEpub(ctx: any, issueId: Id<"issues">): Promise<Response> {
  let issue;
  try {
    issue = await ctx.runQuery(internal.issues.get, { id: issueId });
  } catch {
    // Wrong table (id is actually a magazine) — 404 so the router falls through.
    return new Response("Issue not found", { status: 404 });
  }

  if (!issue) {
    return new Response("Issue not found", { status: 404 });
  }

  if (!issue.epubFileId) {
    return new Response("EPUB not yet generated", { status: 404 });
  }

  const filename = `${issue.title.replace(/[^a-zA-Z0-9\s-]/g, "").replace(/\s+/g, "-")}.epub`;
  return serveStorageFile(ctx, issue.epubFileId, filename);
}

// Serve a stored EPUB by redirecting to its storage CDN URL, rather than
// loading the blob into the action and returning it. Returning a large blob
// directly from an httpAction truncates the response body (Convex caps it):
// small EPUBs came through fine but 15-21MB magazines arrived short and corrupt
// in readers. A 302 to the (time-limited, unguessable) storage URL lets the CDN
// deliver the whole file with correct Content-Length and range support. The
// signed /dl token has already been verified before we get here, so access is
// still gated. `download=` sets the saved filename.
async function serveStorageFile(
  ctx: any,
  storageId: Id<"_storage">,
  filename: string
): Promise<Response> {
  const url = await ctx.storage.getUrl(storageId);
  if (!url) {
    return new Response("EPUB file not found in storage", { status: 404 });
  }
  const redirectUrl = new URL(url);
  redirectUrl.searchParams.set("download", filename);
  return new Response(null, {
    status: 302,
    headers: { Location: redirectUrl.toString() },
  });
}
