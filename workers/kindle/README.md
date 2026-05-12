# Common Stacks Kindle Relay Worker

Cloudflare Worker that takes a book attachment from the Common Stacks
desktop app and hands it to Cloudflare's Email Service for delivery to a
user's `@kindle.com` address. The Cloudflare API token stays on the Worker;
the desktop client only knows the public URL.

Domain expected: `kindle.commonstacks.com` (configurable in `wrangler.toml`).

## One-time setup

You need a Cloudflare account with:
- A zone (e.g. `commonstacks.com`) using Cloudflare DNS.
- Cloudflare Email Service enabled on that zone (adds SPF/DKIM/DMARC under a
  `cf-bounce` subdomain).
- An API token with the **Email Service: Send** permission.

```bash
cd workers/kindle
bun install

# Set secrets:
wrangler secret put CF_API_TOKEN          # API token from above
wrangler secret put CF_ACCOUNT_ID         # Cloudflare account id
wrangler secret put SENDER_EMAIL          # e.g. cs@kindle.commonstacks.com
wrangler secret put SENDER_NAME           # optional, e.g. "Common Stacks"
wrangler secret put SHARED_SECRET         # optional, gate the endpoint with an x-cs-token header
```

Deploy:

```bash
bun run deploy
```

Verify:

```bash
curl https://kindle.commonstacks.com/healthz
# {"ok":true,"message":"alive"}
```

## API

`POST /send` with a JSON body:

```json
{
  "kindle_address":  "yourname@kindle.com",
  "filename":        "Title - Author.epub",
  "content_base64":  "UEsDBBQAAAAIAA...",
  "content_type":    "application/epub+zip",
  "title":           "Title",
  "author":          "Author"
}
```

Responses:

- `200 {"ok":true,"message":"sent to yourname@kindle.com"}` — Cloudflare
  accepted the email. (Amazon may still drop it silently if the sender
  isn't on the recipient's Approved Personal Document E-mail List.)
- `400 {"ok":false,"message":"..."}` — bad input (missing fields,
  oversize attachment, malformed Kindle address).
- `401 {"ok":false,"message":"unauthorized"}` — `SHARED_SECRET` is set on
  the Worker and the request didn't include a matching `x-cs-token` header.
- `502 {"ok":false,"message":"Cloudflare Email Service returned ..."}` —
  the upstream API rejected the message; the response body is included.

## Limits

- **Total message size: 5 MiB.** Cloudflare's hard cap, including the base64
  envelope expansion. The Worker validates ahead of time and rejects with a
  helpful message.
- **Recipient: `*@kindle.com` only.** The Worker enforces this so the relay
  can't be repurposed for general email.

## Privacy posture

The Worker doesn't write to KV/R2/D1. The book bytes are forwarded straight
through to Cloudflare Email Service and not retained. Logs only contain
status/error codes, not payloads — if you change that, document it.
