import { httpRouter } from "convex/server";
import { receiveEmail } from "./ingest";
import { receiveUrl } from "./ingestUrl";
import { receiveArticle } from "./ingestArticle";
import { downloadDirect, downloadSigned } from "./download";
import { opdsRouter } from "./opds";

const http = httpRouter();

// Email ingest
http.route({
  path: "/ingest",
  method: "POST",
  handler: receiveEmail,
});

// URL ingest (from SnapRoute, etc.)
http.route({
  path: "/ingest-url",
  method: "POST",
  handler: receiveUrl,
});

// Article ingest (from browser extensions like SnapRoute)
http.route({
  path: "/ingest-article",
  method: "POST",
  handler: receiveArticle,
});

// Direct download (dashboard)
http.route({
  path: "/download",
  method: "GET",
  handler: downloadDirect,
});

// Signed download (OPDS)
http.route({
  pathPrefix: "/dl/",
  method: "GET",
  handler: downloadSigned,
});

// OPDS catalog (all routes under /opds/)
http.route({
  pathPrefix: "/opds/",
  method: "GET",
  handler: opdsRouter,
});

export default http;
