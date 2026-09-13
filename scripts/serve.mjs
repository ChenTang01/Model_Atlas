import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const defaultRoot = fileURLToPath(new URL("../", import.meta.url));
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".pdf": "application/pdf",
  ".bib": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".woff2": "font/woff2"
};

function normalizeBasePath(value) {
  const base = `/${String(value || "").replace(/^\/+|\/+$/g, "")}`;
  if (!/^\/(?:[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)?$/.test(base)) {
    throw new Error("Base path must contain only letters, numbers, underscores, hyphens, and slashes.");
  }
  return base === "/" ? "" : base;
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return !path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`);
}

function hasHiddenSegment(relative) {
  return relative.split(/[\\/]/).some((segment) => segment.startsWith("."));
}

function byteRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header || "");
  if (!match || (!match[1] && !match[2]) || !size) return null;
  let start;
  let end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || start > end) return null;
  return { start, end };
}

/**
 * Create a static server without listening; use basePath to preview project hosting.
 * fileOverrides maps public, root-relative request paths to alternate files inside
 * the same root. This is useful for previewing a release candidate without
 * mutating the checked-in public bundle.
 */
export function createAtlasServer({ root = defaultRoot, basePath = "", fileOverrides = {} } = {}) {
  const mount = normalizeBasePath(basePath);
  const rootPath = path.resolve(root);
  const overrides = new Map(Object.entries(fileOverrides).map(([requestPath, sourcePath]) => {
    const relativeRequest = String(requestPath || "").replace(/^\/+/, "");
    if (!relativeRequest || /[\\\0:]/.test(relativeRequest)
        || relativeRequest.split("/").some((segment) => !segment || segment === "." || segment === "..")
        || hasHiddenSegment(relativeRequest)) {
      throw new Error(`Invalid file override request path: ${requestPath}`);
    }
    const source = path.resolve(rootPath, String(sourcePath || ""));
    if (!isWithin(rootPath, source) || hasHiddenSegment(path.relative(rootPath, source))) {
      throw new Error(`File override must stay inside the project root: ${sourcePath}`);
    }
    return [relativeRequest, source];
  }));
  let resolvedRoot;

  return createServer(async (request, response) => {
    const finish = (status, message, headers = {}) => {
      response.writeHead(status, {
        "Content-Type": "text/plain; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
        ...headers
      });
      response.end(request.method === "HEAD" ? undefined : message);
    };

    try {
      if (request.method !== "GET" && request.method !== "HEAD") {
        finish(405, "Method not allowed", { Allow: "GET, HEAD" });
        return;
      }

      // Inspect the raw path before URL normalization can erase traversal segments.
      const rawPath = (request.url || "/").split("?")[0];
      let requestPath;
      try {
        requestPath = decodeURIComponent(rawPath);
      } catch {
        finish(400, "Malformed URL");
        return;
      }
      if (!requestPath.startsWith("/") || /[\\\0:]/.test(requestPath)
          || requestPath.split("/").some((segment) => segment === "." || segment === "..")
          || hasHiddenSegment(requestPath)) {
        finish(403, "Forbidden");
        return;
      }

      if (mount && requestPath === mount) {
        const query = (request.url || "").includes("?") ? `?${request.url.split("?").slice(1).join("?")}` : "";
        finish(301, "Redirecting", { Location: `${mount}/${query}` });
        return;
      }
      if (mount && !requestPath.startsWith(`${mount}/`)) {
        finish(404, "Not found");
        return;
      }

      const relative = requestPath.slice(mount.length).replace(/^\/+/, "");
      let candidate = overrides.get(relative) || path.resolve(rootPath, relative);
      if (!isWithin(rootPath, candidate)) {
        finish(403, "Forbidden");
        return;
      }

      const canonicalRoot = await (resolvedRoot ??= realpath(rootPath));
      let canonicalFile = await realpath(candidate);
      if (!isWithin(canonicalRoot, canonicalFile)
          || hasHiddenSegment(path.relative(canonicalRoot, canonicalFile))) {
        finish(403, "Forbidden");
        return;
      }
      let info = await stat(canonicalFile);
      if (info.isDirectory()) {
        if (!requestPath.endsWith("/")) {
          const query = (request.url || "").includes("?") ? `?${request.url.split("?").slice(1).join("?")}` : "";
          finish(301, "Redirecting", { Location: `${rawPath}/${query}` });
          return;
        }
        candidate = path.join(canonicalFile, "index.html");
        canonicalFile = await realpath(candidate);
        if (!isWithin(canonicalRoot, canonicalFile)
            || hasHiddenSegment(path.relative(canonicalRoot, canonicalFile))) {
          finish(403, "Forbidden");
          return;
        }
        info = await stat(canonicalFile);
      }
      if (!info.isFile()) {
        finish(404, "Not found");
        return;
      }

      // HEAD describes the complete representation; ranges apply to GET only.
      const rangeHeader = request.method === "GET" ? request.headers.range : undefined;
      const range = rangeHeader ? byteRange(rangeHeader, info.size) : undefined;
      if (rangeHeader && !range) {
        finish(416, "Requested range not satisfiable", { "Content-Range": `bytes */${info.size}` });
        return;
      }
      const headers = {
        "Content-Type": contentTypes[path.extname(canonicalFile).toLowerCase()] || "application/octet-stream",
        "Content-Length": String(range ? range.end - range.start + 1 : info.size),
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff"
      };
      if (range) headers["Content-Range"] = `bytes ${range.start}-${range.end}/${info.size}`;
      response.writeHead(range ? 206 : 200, headers);
      if (request.method === "HEAD") {
        response.end();
        return;
      }
      const stream = createReadStream(canonicalFile, range || undefined);
      stream.on("error", (error) => response.destroy(error));
      response.on("close", () => stream.destroy());
      stream.pipe(response);
    } catch (error) {
      if (response.headersSent) response.destroy(error);
      else if (["ENOENT", "ENOTDIR"].includes(error.code)) finish(404, "Not found");
      else if (["EACCES", "EPERM"].includes(error.code)) finish(403, "Forbidden");
      else {
        console.error(error);
        finish(500, "Server error");
      }
    }
  });
}

function main() {
  let port = 8000;
  let basePath = "";
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      console.log("Usage: npm start -- [--port 8000] [--base-path /Model_Atlas]");
      return;
    }
    if (arg === "--port") {
      const value = args[++index];
      if (!/^\d+$/.test(value || "")) throw new Error("--port requires a number between 1 and 65535.");
      port = Number(value);
      if (port < 1 || port > 65535) throw new Error("--port requires a number between 1 and 65535.");
    } else if (arg === "--base-path") {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error("--base-path requires a path such as /Model_Atlas.");
      basePath = normalizeBasePath(value);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  const server = createAtlasServer({ basePath });
  server.on("error", (error) => {
    console.error(`Unable to serve Model Atlas: ${error.message}`);
    process.exitCode = 1;
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(`Model Atlas: http://127.0.0.1:${port}${basePath}/`);
    console.log("Press Ctrl+C to stop.");
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
