import crypto from "node:crypto";

const FIRESTORE_SCOPE = "https://www.googleapis.com/auth/datastore";
const FIRESTORE_BASE = (projectId) => `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

let accessTokenCache = {
  token: "",
  expiresAt: 0
};

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return respond(204, "");
  }

  try {
    if (event.httpMethod === "GET") {
      return await handleRead(event);
    }
    if (event.httpMethod === "POST") {
      return await handleIngest(event);
    }
    return respond(405, { error: "GET and POST only" });
  } catch (error) {
    return respond(Number(error?.statusCode || 500), { error: String(error?.message || error) });
  }
}

async function handleRead(event) {
  const batchKey = sanitizeBatchKey(event.queryStringParameters?.batch || "active");
  const limit = clamp(Number(event.queryStringParameters?.limit || 120), 1, 300);
  if (!hasFirestoreBridgeConfig()) {
    return respond(200, {
      ok: true,
      configured: false,
      batchKey,
      deviceId: "",
      deviceName: "",
      lastReadingAt: "",
      latestGravity: "",
      latestTempF: "",
      readings: []
    });
  }

  const { projectId, accessToken } = await firestoreContext();
  const readings = await fetchReadings({ projectId, accessToken, batchKey, limit });
  const latest = readings[0] || null;

  return respond(200, {
    ok: true,
    configured: true,
    batchKey,
    deviceId: latest?.deviceId || "",
    deviceName: latest?.deviceName || "",
    lastReadingAt: latest?.telemetryAt || "",
    latestGravity: latest?.gravity ?? "",
    latestTempF: toFahrenheit(latest?.temperatureC),
    readings
  });
}

async function handleIngest(event) {
  const body = parseBody(event);
  const batchKey = sanitizeBatchKey(
    event.queryStringParameters?.batch ||
    body.batchKey ||
    body.batch ||
    "active"
  );

  validateWebhookSecret(event, body);

  const reading = normalizeIncomingReading(body, batchKey);
  const { projectId, accessToken } = await firestoreContext();

  await upsertBatchMeta({ projectId, accessToken, batchKey, reading });
  const created = await createReading({ projectId, accessToken, batchKey, reading });

  return respond(200, {
    ok: true,
    batchKey,
    readingId: reading.readingId,
    duplicate: !created
  });
}

function validateWebhookSecret(event, body) {
  const expected = process.env.RAPT_WEBHOOK_SECRET;
  if (!expected) return;

  const headers = normalizeHeaders(event.headers || {});
  const provided = headers["x-meadevil-secret"] || event.queryStringParameters?.secret || body.secret || "";
  if (provided !== expected) {
    throw Object.assign(new Error("Invalid webhook secret"), { statusCode: 401 });
  }
}

function hasFirestoreBridgeConfig() {
  return Boolean(
    (process.env.GOOGLE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID) &&
    process.env.GOOGLE_CLIENT_EMAIL &&
    process.env.GOOGLE_PRIVATE_KEY
  );
}

function parseBody(event) {
  if (!event.body) return {};
  const raw = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
  try {
    return JSON.parse(raw);
  } catch {
    throw Object.assign(new Error("Invalid JSON body"), { statusCode: 400 });
  }
}

function normalizeIncomingReading(body, batchKey) {
  const gravity = Number(body.gravity);
  if (!Number.isFinite(gravity)) {
    throw Object.assign(new Error("Gravity is required"), { statusCode: 400 });
  }

  const telemetryAt = normalizeIso(body.created_date || body.createdDate || body.telemetryAt) || new Date().toISOString();
  const deviceId = String(body.device_id || body.deviceId || "");
  const deviceName = String(body.device_name || body.deviceName || "");
  const temperatureC = finiteNumber(body.temperature_c ?? body.temperatureC ?? body.temperature);
  const battery = finiteNumber(body.battery);
  const rssi = finiteNumber(body.rssi);
  const receivedAt = new Date().toISOString();
  const readingId = sanitizeDocumentId(
    body.reading_id ||
    body.readingId ||
    `${deviceId || "rapt"}-${telemetryAt}`
  );

  return {
    batchKey,
    readingId,
    deviceId,
    deviceName,
    gravity: roundTo(gravity, 3),
    temperatureC,
    battery,
    rssi,
    telemetryAt,
    receivedAt
  };
}

async function firestoreContext() {
  const projectId = process.env.GOOGLE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || "meadevil-app";
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  const privateKey = normalizePrivateKey(process.env.GOOGLE_PRIVATE_KEY || "");

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("Missing Firestore bridge env vars: GOOGLE_PROJECT_ID, GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY");
  }

  const accessToken = await getGoogleAccessToken({ clientEmail, privateKey });
  return { projectId, accessToken };
}

async function getGoogleAccessToken({ clientEmail, privateKey }) {
  const now = Math.floor(Date.now() / 1000);
  if (accessTokenCache.token && accessTokenCache.expiresAt - 60 > now) {
    return accessTokenCache.token;
  }

  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({
    iss: clientEmail,
    scope: FIRESTORE_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    iat: now,
    exp: now + 3600
  }));
  const unsigned = `${header}.${payload}`;
  let signature;
  try {
    signature = crypto.createSign("RSA-SHA256").update(unsigned).end().sign(privateKey);
  } catch (error) {
    throw new Error("GOOGLE_PRIVATE_KEY could not be parsed. Re-copy the full private_key value from the Firebase service-account JSON, including BEGIN/END lines.");
  }
  const assertion = `${unsigned}.${base64Url(signature)}`;

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || !json.access_token) {
    throw new Error(`Could not obtain Google access token: ${json.error || response.status}`);
  }

  accessTokenCache = {
    token: json.access_token,
    expiresAt: now + Number(json.expires_in || 3600)
  };
  return accessTokenCache.token;
}

async function upsertBatchMeta({ projectId, accessToken, batchKey, reading }) {
  const url = `${FIRESTORE_BASE(projectId)}/raptTelemetry/${encodeURIComponent(batchKey)}`;
  const body = {
    fields: {
      batchKey: { stringValue: batchKey },
      deviceId: { stringValue: reading.deviceId },
      deviceName: { stringValue: reading.deviceName },
      lastReadingAt: { timestampValue: reading.telemetryAt },
      updatedAt: { timestampValue: reading.receivedAt },
      latestGravity: { doubleValue: reading.gravity },
      latestTempF: numericField(toFahrenheit(reading.temperatureC))
    }
  };

  await firestoreRequest(url, {
    method: "PATCH",
    accessToken,
    body
  });
}

async function createReading({ projectId, accessToken, batchKey, reading }) {
  const url = `${FIRESTORE_BASE(projectId)}/raptTelemetry/${encodeURIComponent(batchKey)}/readings?documentId=${encodeURIComponent(reading.readingId)}`;
  const body = {
    fields: {
      batchKey: { stringValue: batchKey },
      readingId: { stringValue: reading.readingId },
      deviceId: { stringValue: reading.deviceId },
      deviceName: { stringValue: reading.deviceName },
      gravity: { doubleValue: reading.gravity },
      temperatureC: numericField(reading.temperatureC),
      battery: numericField(reading.battery),
      rssi: numericField(reading.rssi),
      telemetryAt: { timestampValue: reading.telemetryAt },
      receivedAt: { timestampValue: reading.receivedAt },
      source: { stringValue: "rapt-webhook" }
    }
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (response.status === 409) {
    return false;
  }

  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Firestore write failed: ${json.error?.message || response.status}`);
  }

  return true;
}

async function fetchReadings({ projectId, accessToken, batchKey, limit }) {
  const parent = `${FIRESTORE_BASE(projectId)}/raptTelemetry/${encodeURIComponent(batchKey)}:runQuery`;
  const body = {
    structuredQuery: {
      from: [{ collectionId: "readings" }],
      orderBy: [{ field: { fieldPath: "telemetryAt" }, direction: "DESCENDING" }],
      limit
    }
  };

  const response = await fetch(parent, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const json = await response.json().catch(() => ([]));
  if (response.status === 404) {
    return [];
  }
  if (!response.ok) {
    const message = Array.isArray(json) ? response.status : (json.error?.message || response.status);
    throw new Error(`Firestore query failed: ${message}`);
  }

  return (Array.isArray(json) ? json : [])
    .map((entry) => fromFirestoreDocument(entry.document))
    .filter(Boolean);
}

async function firestoreRequest(url, { method, accessToken, body }) {
  const response = await fetch(url, {
    method,
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Firestore request failed: ${json.error?.message || response.status}`);
  }
  return json;
}

function fromFirestoreDocument(document) {
  if (!document?.fields) return null;
  const fields = Object.fromEntries(
    Object.entries(document.fields).map(([key, value]) => [key, fromFirestoreValue(value)])
  );

  return {
    readingId: fields.readingId || "",
    deviceId: fields.deviceId || "",
    deviceName: fields.deviceName || "",
    gravity: fields.gravity,
    temperatureC: fields.temperatureC,
    battery: fields.battery,
    rssi: fields.rssi,
    telemetryAt: fields.telemetryAt || "",
    receivedAt: fields.receivedAt || ""
  };
}

function fromFirestoreValue(value) {
  if (!value || typeof value !== "object") return null;
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("timestampValue" in value) return value.timestampValue;
  if ("booleanValue" in value) return Boolean(value.booleanValue);
  if ("nullValue" in value) return null;
  return null;
}

function numericField(value) {
  return Number.isFinite(Number(value)) ? { doubleValue: Number(value) } : { nullValue: null };
}

function normalizeHeaders(headers) {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [String(key || "").toLowerCase(), value])
  );
}

function normalizePrivateKey(value) {
  let key = String(value || "").trim();
  if (!key) return "";

  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1);
  }

  key = key.replace(/\\n/g, "\n").trim();

  if (!key.includes("BEGIN PRIVATE KEY") || !key.includes("END PRIVATE KEY")) {
    return key;
  }

  if (!key.endsWith("\n")) {
    key = `${key}\n`;
  }

  return key;
}

function normalizeIso(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function sanitizeBatchKey(value) {
  const cleaned = String(value || "active").trim().replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || "active";
}

function sanitizeDocumentId(value) {
  return sanitizeBatchKey(String(value || `reading-${Date.now()}`));
}

function finiteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function toFahrenheit(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? roundTo((numeric * 9 / 5) + 32, 1) : null;
}

function roundTo(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function base64Url(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(String(input));
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function respond(statusCode, body) {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  return {
    statusCode,
    headers: {
      "Content-Type": typeof body === "string" ? "text/plain; charset=utf-8" : "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, x-meadevil-secret"
    },
    body: payload
  };
}
