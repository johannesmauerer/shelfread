import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { navigationFeed, acquisitionFeed } from "./lib/opdsXml";
import { createSignedToken } from "./lib/signing";

const XML_HEADERS = {
  "Content-Type": "application/atom+xml;charset=utf-8",
  "Cache-Control": "no-cache",
};

function xmlResponse(body: string): Response {
  return new Response(body, { status: 200, headers: XML_HEADERS });
}

function checkAuth(request: Request): Response | null {
  const opdsUser = process.env.OPDS_USERNAME || "shelf";
  const opdsPass = process.env.OPDS_PASSWORD;

  // If no password configured, skip auth (dev mode)
  if (!opdsPass) return null;

  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Basic ")) {
    return new Response("Unauthorized", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="Shelf OPDS"' },
    });
  }

  const decoded = atob(authHeader.slice(6));
  const [user, pass] = decoded.split(":");
  if (user !== opdsUser || pass !== opdsPass) {
    return new Response("Forbidden", { status: 403 });
  }

  return null;
}

function getBasePath(request: Request): string {
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/opds\/([^/]+)/);
  return match ? `/opds/${match[1]}` : "/opds";
}

function getDownloadSecret(): string {
  return process.env.DOWNLOAD_SECRET || "shelf-dev-secret";
}

// Single router for all OPDS paths
export const opdsRouter = httpAction(async (ctx, request) => {
  const authErr = checkAuth(request);
  if (authErr) return authErr;

  const url = new URL(request.url);
  const path = url.pathname;
  const basePath = getBasePath(request);

  // /opds/{secret}/catalog.xml
  if (path.endsWith("/catalog.xml")) {
    return handleCatalog(ctx, basePath);
  }
  // /opds/{secret}/series.xml (list of all series, not a specific one)
  if (path.endsWith("/series.xml") && !path.includes("/series/")) {
    return handleSeriesList(ctx, basePath);
  }
  // /opds/{secret}/series/{slug}.xml
  const slugMatch = path.match(/\/series\/([^/.]+)\.xml$/);
  if (slugMatch) {
    return handleSeriesIssues(ctx, basePath, slugMatch[1]);
  }
  // /opds/{secret}/recent.xml
  if (path.endsWith("/recent.xml")) {
    return handleRecent(ctx, basePath);
  }

  return new Response("Not found", { status: 404 });
});

async function handleCatalog(ctx: any, basePath: string): Promise<Response> {
  const allSeries = await ctx.runQuery(internal.series.listInternal);
  const latestDate = allSeries.reduce(
    (max: number, s: any) => Math.max(max, s.lastIssueDate || s.createdAt),
    0
  );
  const updated = latestDate ? new Date(latestDate).toISOString() : new Date().toISOString();

  return xmlResponse(
    navigationFeed({
      id: "urn:shelf:root",
      title: "Shelf — My Newsletters",
      selfHref: `${basePath}/catalog.xml`,
      startHref: `${basePath}/catalog.xml`,
      updated,
      entries: [
        {
          title: "By Series",
          id: "urn:shelf:series",
          href: `${basePath}/series.xml`,
          type: "application/atom+xml;profile=opds-catalog;kind=navigation",
          content: "Browse newsletters organized by publication",
          updated,
        },
        {
          title: "Recent Issues",
          id: "urn:shelf:recent",
          href: `${basePath}/recent.xml`,
          type: "application/atom+xml;profile=opds-catalog;kind=acquisition",
          content: "Latest newsletter issues across all series",
          updated,
        },
      ],
    })
  );
}

async function handleSeriesList(ctx: any, basePath: string): Promise<Response> {
  const allSeries = await ctx.runQuery(internal.series.listInternal);
  const updated = new Date().toISOString();

  return xmlResponse(
    navigationFeed({
      id: "urn:shelf:series-list",
      title: "Shelf — All Series",
      selfHref: `${basePath}/series.xml`,
      startHref: `${basePath}/catalog.xml`,
      updated,
      entries: allSeries.map((s: any) => ({
        title: `${s.name} (${s.issueCount} issues)`,
        id: `urn:shelf:series:${s.slug}`,
        href: `${basePath}/series/${s.slug}.xml`,
        type: "application/atom+xml;profile=opds-catalog;kind=acquisition",
        content: `${s.issueCount} issues from ${s.senderName || s.senderEmail}`,
        updated: new Date(s.lastIssueDate || s.createdAt).toISOString(),
      })),
    })
  );
}

async function handleSeriesIssues(
  ctx: any,
  basePath: string,
  slug: string
): Promise<Response> {
  const series = await ctx.runQuery(internal.series.findBySlug, { slug });
  if (!series) {
    return new Response("Series not found", { status: 404 });
  }

  const issues = await ctx.runQuery(internal.issues.listBySeries, {
    seriesId: series._id,
  });
  const readyIssues = issues.filter((i: any) => i.status === "ready" && i.epubFileId);
  const secret = getDownloadSecret();
  const updated = readyIssues.length > 0
    ? new Date(readyIssues[0].receivedAt).toISOString()
    : new Date().toISOString();

  const entries = await Promise.all(
    readyIssues.map(async (issue: any) => {
      const token = await createSignedToken(issue._id, secret);
      return {
        title: issue.title,
        id: `urn:shelf:issue:${issue._id}`,
        author: issue.author || undefined,
        updated: new Date(issue.receivedAt).toISOString(),
        published: issue.issueDate
          ? new Date(issue.issueDate).toISOString()
          : undefined,
        summary: issue.summary || undefined,
        downloadHref: `/dl/${token}`,
        sizeBytes: issue.epubSizeBytes,
      };
    })
  );

  return xmlResponse(
    acquisitionFeed({
      id: `urn:shelf:series:${slug}`,
      title: `Shelf — ${series.name}`,
      selfHref: `${basePath}/series/${slug}.xml`,
      startHref: `${basePath}/catalog.xml`,
      updated,
      entries,
    })
  );
}

async function handleRecent(ctx: any, basePath: string): Promise<Response> {
  const issues = await ctx.runQuery(internal.issues.listRecentInternal);
  const readyIssues = issues.filter((i: any) => i.status === "ready" && i.epubFileId);
  const secret = getDownloadSecret();
  const updated = readyIssues.length > 0
    ? new Date(readyIssues[0].receivedAt).toISOString()
    : new Date().toISOString();

  const seriesCache = new Map<string, any>();
  const entries = await Promise.all(
    readyIssues.map(async (issue: any) => {
      let series = seriesCache.get(issue.seriesId);
      if (!series) {
        series = await ctx.runQuery(internal.series.getInternal, {
          id: issue.seriesId,
        });
        if (series) seriesCache.set(issue.seriesId, series);
      }

      const token = await createSignedToken(issue._id, secret);
      return {
        title: issue.title,
        id: `urn:shelf:issue:${issue._id}`,
        author: issue.author || undefined,
        updated: new Date(issue.receivedAt).toISOString(),
        published: issue.issueDate
          ? new Date(issue.issueDate).toISOString()
          : undefined,
        summary: issue.summary || undefined,
        downloadHref: `/dl/${token}`,
        seriesName: series?.name,
        sizeBytes: issue.epubSizeBytes,
      };
    })
  );

  return xmlResponse(
    acquisitionFeed({
      id: "urn:shelf:recent",
      title: "Shelf — Recent Issues",
      selfHref: `${basePath}/recent.xml`,
      startHref: `${basePath}/catalog.xml`,
      updated,
      entries,
    })
  );
}
