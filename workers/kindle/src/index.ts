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

    const cfBody = {
      to: payload.kindle_address,
      from: { email: fromEmail, name: fromName },
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

    if (cfRes.ok) {
      return json({ ok: true, message: `sent to ${payload.kindle_address}` });
    }

    const errText = await cfRes.text();
    console.error("cloudflare email send failed", cfRes.status, errText);
    return json(
      {
        ok: false,
        message: `Cloudflare Email Service returned ${cfRes.status}: ${truncate(
          errText,
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
