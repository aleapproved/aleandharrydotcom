const DEFAULT_ALLOWED_ORIGINS = new Set([
  "https://aleandharry.com",
  "https://www.aleandharry.com",
]);
const AIRTABLE_BASE_ID = "appzg1GJnurC95pqv";
const AIRTABLE_TABLE_ID = "tblN2FjbFfsoTGJkH";
const MAX_PARTY_SIZE = 20;
const MAX_BODY_BYTES = 32 * 1024;
const AIRTABLE_TIMEOUT_MS = 8_000;
const MAX_LENGTHS = { name: 200, email: 200, guestNames: 2000, dietary: 1000, message: 2000 };
const RSVP_ENDPOINT_RATE_LIMIT_KEY = "rsvp:/api/rsvp";

function allowedOrigins(env) {
  const configured = typeof env?.RSVP_ALLOWED_ORIGINS === "string"
    ? env.RSVP_ALLOWED_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean)
    : [];
  return new Set(configured.length ? configured : DEFAULT_ALLOWED_ORIGINS);
}

function corsHeaders(origin = "") {
  const headers = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Vary": "Origin",
  };
  if (origin) headers["Access-Control-Allow-Origin"] = origin;
  else delete headers["Access-Control-Allow-Origin"];
  return headers;
}

function jsonResponse(status, body, origin = "", extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin), ...extraHeaders },
  });
}

function trim(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEmail(value) {
  return trim(value).toLowerCase();
}

// Free text is capped rather than refused: a guest who writes us an essay
// should not lose it to an error message, and the tail of a long message is
// not worth a rejection. An address is different — see validate().
function text(value, field) {
  return trim(value).slice(0, MAX_LENGTHS[field]);
}

function validate(payload) {
  const name = text(payload.name, "name");
  // Not capped like the rest: cutting an address to length can leave one that
  // still looks like an address. guest@sub.sub…example.com trimmed at 200
  // characters ends "…sub.ex", which passes the test below and is stored as a
  // valid address nobody can reach, under a guest who was told we had it. A
  // long one is refused instead, so the failure is theirs to see and fix.
  const email = normalizeEmail(payload.email);
  const attending = payload.attending;
  const partySize = typeof payload.partySize === "number"
    ? payload.partySize
    : typeof payload.partySize === "string" && payload.partySize.trim() !== ""
      ? Number(payload.partySize)
      : NaN;
  const message = text(payload.message, "message");

  if (!name) {
    return { error: "Please enter a name." };
  }
  if (!email || email.length > MAX_LENGTHS.email
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "Please enter an email address we can reach you on." };
  }
  if (attending !== "Yes" && attending !== "No") {
    return { error: "Please specify whether you're attending." };
  }
  // Someone who isn't coming has no party, no seats and no dietary needs, so
  // those fields are dropped rather than stored as stale text.
  if (attending === "No") {
    return { name, email, attending, partySize: 0, guestNames: "", dietary: "", message };
  }
  if (!Number.isInteger(partySize) || partySize < 1 || partySize > MAX_PARTY_SIZE) {
    return { error: "Party size must be a whole number between 1 and " + MAX_PARTY_SIZE + "." };
  }
  return {
    name,
    email,
    attending,
    partySize,
    guestNames: text(payload.guestNames, "guestNames"),
    dietary: text(payload.dietary, "dietary"),
    message,
  };
}

async function readBody(request) {
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function rateLimitKey(email) {
  const bytes = new TextEncoder().encode(email.toLowerCase());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function rateLimitAllowed(binding, key, limiter) {
  try {
    const result = await binding.limit({ key });
    if (!result || typeof result.success !== "boolean") throw new Error("invalid_response");
    return result.success;
  } catch (error) {
    console.error(JSON.stringify({
      event: "rsvp_rate_limiter_failed",
      limiter,
      error: error instanceof Error ? error.name : "unknown",
    }));
    return null;
  }
}

export default {
  async fetch(request, env) {
    const origins = allowedOrigins(env);
    const requestOrigin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS") {
      if (!origins.has(requestOrigin)) {
        return new Response(null, { status: 403, headers: corsHeaders() });
      }
      return new Response(null, { headers: corsHeaders(requestOrigin) });
    }

    if (request.method !== "POST") {
      return jsonResponse(405, { error: "Method not allowed." }, origins.has(requestOrigin) ? requestOrigin : "");
    }

    if (!origins.has(requestOrigin)) {
      return jsonResponse(403, { error: "Request origin is not allowed." });
    }

    const contentType = (request.headers.get("Content-Type") || "").split(";", 1)[0].trim().toLowerCase();
    if (contentType !== "application/json") {
      return jsonResponse(415, { error: "Content-Type must be application/json." }, requestOrigin);
    }

    const declaredLength = request.headers.get("Content-Length");
    if (declaredLength && Number(declaredLength) > MAX_BODY_BYTES) {
      return jsonResponse(413, { error: "Request body is too large." }, requestOrigin);
    }

    let payload;
    try {
      const body = await readBody(request);
      if (body === null) {
        return jsonResponse(413, { error: "Request body is too large." }, requestOrigin);
      }
      payload = JSON.parse(body);
    } catch {
      return jsonResponse(400, { error: "Invalid request body." }, requestOrigin);
    }

    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return jsonResponse(400, { error: "Invalid request body." }, requestOrigin);
    }

    // Honeypot: a hidden field real guests never fill in, bots often do.
    if (payload.company) {
      return jsonResponse(200, { ok: true }, requestOrigin);
    }

    const result = validate(payload);
    if (result.error) {
      return jsonResponse(400, { error: result.error }, requestOrigin);
    }

    const emailRateLimiter = env?.RSVP_RATE_LIMITER;
    const endpointRateLimiter = env?.RSVP_ENDPOINT_RATE_LIMITER;
    if (!emailRateLimiter || typeof emailRateLimiter.limit !== "function"
        || !endpointRateLimiter || typeof endpointRateLimiter.limit !== "function") {
      console.error(JSON.stringify({ event: "rsvp_rate_limiter_missing" }));
      return jsonResponse(500, { error: "The RSVP service is not configured." }, requestOrigin);
    }

    const emailAllowed = await rateLimitAllowed(
      emailRateLimiter,
      await rateLimitKey(result.email),
      "email",
    );
    if (emailAllowed === null) {
      return jsonResponse(503, { error: "The RSVP service is temporarily unavailable. Please try again." }, requestOrigin);
    }
    if (!emailAllowed) {
      return jsonResponse(429, { error: "Please wait a little before sending another RSVP." }, requestOrigin, {
        "Retry-After": "60",
      });
    }

    const endpointAllowed = await rateLimitAllowed(
      endpointRateLimiter,
      RSVP_ENDPOINT_RATE_LIMIT_KEY,
      "endpoint",
    );
    if (endpointAllowed === null) {
      return jsonResponse(503, { error: "The RSVP service is temporarily unavailable. Please try again." }, requestOrigin);
    }
    if (!endpointAllowed) {
      return jsonResponse(429, { error: "Please wait a little before sending another RSVP." }, requestOrigin, {
        "Retry-After": "60",
      });
    }

    if (!env?.AIRTABLE_RUNTIME_TOKEN || typeof env.AIRTABLE_RUNTIME_TOKEN !== "string") {
      return jsonResponse(500, { error: "The RSVP service is not configured." }, requestOrigin);
    }

    let airtableResponse;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), AIRTABLE_TIMEOUT_MS);
    try {
      airtableResponse = await fetch(
        `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${env.AIRTABLE_RUNTIME_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            performUpsert: { fieldsToMergeOn: ["Email"] },
            records: [
              {
                fields: {
                  Name: result.name,
                  Email: result.email,
                  Attending: result.attending,
                  "Party Size": result.partySize,
                  "Guest Names": result.guestNames,
                  "Dietary Requirements": result.dietary,
                  Message: result.message,
                },
              },
            ],
          }),
          signal: controller.signal,
        },
      );
    } catch (error) {
      console.error(JSON.stringify({
        event: "airtable_request_failed",
        error: error instanceof Error ? error.name : "unknown",
      }));
      return jsonResponse(502, { error: "Something went wrong saving your RSVP. Please try again." }, requestOrigin);
    } finally {
      clearTimeout(timeout);
    }

    if (!airtableResponse.ok) {
      return jsonResponse(502, { error: "Something went wrong saving your RSVP. Please try again." }, requestOrigin);
    }

    return jsonResponse(200, { ok: true }, requestOrigin);
  },
};
