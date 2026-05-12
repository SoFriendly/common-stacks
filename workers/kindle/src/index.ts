/// <reference types="@cloudflare/workers-types" />

/**
 * Common Stacks → Kindle email relay.
 *
 * Accepts a book attachment + Kindle address from the desktop app, hands the
 * email off to Cloudflare's Email Service. The Cloudflare API token never
 * leaves the Worker; the app only knows the public URL.
 *
 * Wire it up:
 *   wrangler secret put CF_API_TOKEN
 *   wrangler secret put CF_ACCOUNT_ID
 *   wrangler secret put SENDER_EMAIL
 *   wrangler secret put SENDER_NAME      (optional)
 *   wrangler secret put SHARED_SECRET    (optional, lets you gate the endpoint)
 */

interface Env {
  CF_API_TOKEN: string;
  CF_ACCOUNT_ID: string;
  SENDER_EMAIL: string;
  SENDER_NAME?: string;
  SHARED_SECRET?: string;
}

interface SendRequest {
  kindle_address: string;
  filename: string;
  /** Base64-encoded book bytes. */
  content_base64: string;
  /** MIME type. Defaults to application/epub+zip. */
  content_type?: string;
  title?: string;
  author?: string;
}

interface SendResponse {
  ok: boolean;
  message: string;
}

const MAX_BODY_BYTES = 5 * 1024 * 1024; // Cloudflare Email Service total cap.

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/healthz") {
      return json({ ok: true, message: "alive" });
    }
    if (request.method === "GET" && url.pathname === "/info") {
      // Public info every caller is allowed to know — the sender address the
      // user needs to whitelist in Amazon's Approved Personal Document list.
      return jsonRaw(
        {
          sender_email: env.SENDER_EMAIL,
          sender_name: env.SENDER_NAME ?? "Common Stacks",
        },
        200,
        // Cache for an hour at the edge; the value rarely changes.
        { "cache-control": "public, max-age=3600" },
      );
    }
    if (request.method !== "POST" || url.pathname !== "/send") {
      return json({ ok: false, message: "not found" }, 404);
    }

    if (env.SHARED_SECRET) {
      const token = request.headers.get("x-cs-token");
      if (token !== env.SHARED_SECRET) {
        return json({ ok: false, message: "unauthorized" }, 401);
      }
    }

    let payload: SendRequest;
    try {
      payload = await request.json();
    } catch {
      return json({ ok: false, message: "invalid JSON body" }, 400);
    }

    const validationError = validate(payload);
    if (validationError) return json({ ok: false, message: validationError }, 400);

    const subject = formatSubject(payload);
    const fromEmail = env.SENDER_EMAIL;
    const fromName = env.SENDER_NAME ?? "Common Stacks";
    // Cloudflare Email Service accepts `from` as either a raw RFC 5322
    // mailbox string ("Name <addr>") or an object with `address` + `name`
    // keys. Sticking with the string form to keep the schema unambiguous.
    const fromHeader = fromName
      ? `${fromName} <${fromEmail}>`
      : fromEmail;

    const cfBody = {
      to: payload.kindle_address,
      from: fromHeader,
      subject,
      text: "Sent via Common Stacks.",
      attachments: [
        {
          content: payload.content_base64,
          filename: payload.filename,
          type: payload.content_type ?? "application/epub+zip",
          disposition: "attachment",
        },
      ],
    };

    const cfRes = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/email/sending/send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.CF_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(cfBody),
      },
    );

    const cfText = await cfRes.text();
    // Always log so we can confirm what Cloudflare actually said. The
    // success envelope looks like `{success: true, result: {...}}`.
    console.log("cloudflare email response", cfRes.status, truncate(cfText, 400));

    if (cfRes.ok) {
      try {
        const parsed = JSON.parse(cfText);
        if (parsed && parsed.success === false) {
          console.error("cloudflare reported success=false", cfText);
          return json(
            {
              ok: false,
              message: `Cloudflare Email Service rejected the message: ${truncate(
                cfText,
                400,
              )}`,
            },
            502,
          );
        }
        // `success: true` can still mean "accepted but went nowhere" when
        // the sending domain isn't fully verified. Treat empty delivered +
        // empty queued as a real failure so the user sees something.
        const result = parsed?.result ?? {};
        const delivered = Array.isArray(result.delivered) ? result.delivered : [];
        const queued = Array.isArray(result.queued) ? result.queued : [];
        const bounces = Array.isArray(result.permanent_bounces)
          ? result.permanent_bounces
          : [];
        if (delivered.length === 0 && queued.length === 0) {
          console.error("cloudflare accepted but didn't send", cfText);
          return json(
            {
              ok: false,
              message:
                bounces.length > 0
                  ? `Amazon rejected the message: ${JSON.stringify(bounces).slice(
                      0,
                      400,
                    )}`
                  : "Cloudflare Email Service accepted the request but didn't deliver or queue it. The sending domain is most likely not fully verified — check DKIM/SPF/DMARC in the Cloudflare dashboard's Email Sending settings.",
            },
            502,
          );
        }
      } catch {
        // body isn't json — fine, the 2xx status alone is enough
      }
      return json({ ok: true, message: `sent to ${payload.kindle_address}` });
    }

    console.error("cloudflare email send failed", cfRes.status, cfText);
    return json(
      {
        ok: false,
        message: `Cloudflare Email Service returned ${cfRes.status}: ${truncate(
          cfText,
          400,
        )}`,
      },
      502,
    );
  },
};

function validate(p: SendRequest): string | null {
  if (!p.kindle_address || !/^[^@]+@kindle\.com$/i.test(p.kindle_address)) {
    return "kindle_address must be a @kindle.com address";
  }
  if (!p.filename) return "filename is required";
  if (!p.content_base64) return "content_base64 is required";

  // Rough check on attachment + envelope size. base64 expands by ~4/3.
  const estimatedBytes = Math.ceil((p.content_base64.length * 3) / 4);
  if (estimatedBytes > MAX_BODY_BYTES - 4096) {
    return `attachment too large (~${(estimatedBytes / 1024 / 1024).toFixed(
      1,
    )} MB) — Cloudflare Email Service caps total message at 5 MiB`;
  }
  return null;
}

function formatSubject(p: SendRequest): string {
  if (p.title && p.author) return `${p.title} — ${p.author}`;
  if (p.title) return p.title;
  return "Common Stacks book";
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}

function json(payload: SendResponse, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function jsonRaw(
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      ...extraHeaders,
    },
  });
}
