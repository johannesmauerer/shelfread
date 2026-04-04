import { httpRouter } from "convex/server";
import { receiveEmail } from "./ingest";
import { downloadDirect, downloadSigned } from "./download";
import { opdsRouter } from "./opds";

const http = httpRouter();

// Email ingest
http.route({
  path: "/ingest",
  method: "POST",
  handler: receiveEmail,
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
