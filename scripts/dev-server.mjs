import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");
const envPath = path.join(rootDir, ".env.local");
const port = Number(process.env.MEADEVIL_DEV_PORT || loadLocalEnv().MEADEVIL_DEV_PORT || 8910);

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".toml": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8"
};

async function main() {
  const mentorModule = await import(pathToFileURL(path.join(rootDir, "netlify", "functions", "meadevil-mentor.mjs")).href);
  const firebaseModule = await import(pathToFileURL(path.join(rootDir, "netlify", "functions", "firebase-config.mjs")).href);
  const raptModule = await import(pathToFileURL(path.join(rootDir, "netlify", "functions", "rapt-bridge.mjs")).href);

  const server = createServer(async (req, res) => {
    try {
      if (!req.url) {
        sendText(res, 400, "Missing request URL");
        return;
      }

      const requestUrl = new URL(req.url, `http://127.0.0.1:${port}`);

      if (requestUrl.pathname === "/.netlify/functions/meadevil-mentor") {
        await handleFunction(req, res, mentorModule.handler, requestUrl);
        return;
      }

      if (requestUrl.pathname === "/.netlify/functions/firebase-config") {
        await handleFunction(req, res, firebaseModule.handler, requestUrl);
        return;
      }

      if (requestUrl.pathname === "/.netlify/functions/rapt-bridge") {
        await handleFunction(req, res, raptModule.handler, requestUrl);
        return;
      }

      if (req.method !== "GET" && req.method !== "HEAD") {
        sendText(res, 405, "Method not allowed");
        return;
      }

      await handleStatic(req, res, requestUrl);
    } catch (error) {
      sendJson(res, 500, {
        error: "Local dev server failed",
        detail: String(error && error.message ? error.message : error)
      });
    }
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`MeadEvil local dev server running at http://127.0.0.1:${port}`);
    console.log("Functions mounted:");
    console.log("  /.netlify/functions/meadevil-mentor");
    console.log("  /.netlify/functions/firebase-config");
    console.log("  /.netlify/functions/rapt-bridge");
    if (!process.env.OPENAI_API_KEY) {
      console.log("OPENAI_API_KEY is not set. Add it to .env.local or your shell before testing the live mentor.");
    }
  });
}

async function handleFunction(req, res, handler, requestUrl) {
  const body = await readRequestBody(req);
  const event = {
    body,
    headers: req.headers,
    httpMethod: req.method || "GET",
    path: requestUrl.pathname,
    queryStringParameters: Object.fromEntries(requestUrl.searchParams.entries()),
    rawUrl: requestUrl.toString()
  };

  const result = await handler(event);
  const headers = normalizeHeaders(result && result.headers);
  const statusCode = Number(result && result.statusCode) || 200;
  const responseBody = typeof (result && result.body) === "string" ? result.body : "";

  res.writeHead(statusCode, headers);
  if ((req.method || "GET").toUpperCase() !== "HEAD") {
    res.end(responseBody);
  } else {
    res.end();
  }
}

async function handleStatic(req, res, requestUrl) {
  const safePath = normalizeStaticPath(requestUrl.pathname);
  const filePath = path.join(rootDir, safePath);
  let finalPath = filePath;

  try {
    const info = await stat(finalPath);
    if (info.isDirectory()) {
      finalPath = path.join(finalPath, "index.html");
    }
  } catch {
    if (!path.extname(finalPath)) {
      finalPath = path.join(finalPath, "index.html");
    }
  }

  if (!finalPath.startsWith(rootDir)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  const data = await readFile(finalPath);
  const ext = path.extname(finalPath).toLowerCase();
  const contentType = CONTENT_TYPES[ext] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": contentType, "Cache-Control": "no-store" });
  if ((req.method || "GET").toUpperCase() !== "HEAD") {
    res.end(data);
  } else {
    res.end();
  }
}

function normalizeStaticPath(rawPath) {
  const decoded = decodeURIComponent(rawPath || "/");
  const trimmed = decoded === "/" ? "/index.html" : decoded;
  const normalized = path.normalize(trimmed).replace(/^([/\\])+/, "");
  return normalized || "index.html";
}

function normalizeHeaders(headers) {
  const normalized = { ...(headers || {}) };
  if (!Object.keys(normalized).some((key) => key.toLowerCase() === "content-type")) {
    normalized["Content-Type"] = "application/json; charset=utf-8";
  }
  return normalized;
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function loadLocalEnv() {
  const values = {};
  try {
    const raw = readFileSync(envPath, "utf8");
    raw.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return;
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex === -1) return;
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim().replace(/^['"]|['"]$/g, "");
      if (!key) return;
      values[key] = value;
      if (!process.env[key]) process.env[key] = value;
    });
  } catch {
    return values;
  }
  return values;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
