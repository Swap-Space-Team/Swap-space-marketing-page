# Property Email Snippet Generator

An admin tool that turns a live SwapSpace property listing into a copy-paste-ready,
email-client-safe HTML card for **Resend** broadcasts.

Lives at **`/admin/email-snippet/`** and is linked from the admin header
(`✉️ Email Snippets`). Auth is shared with the rest of `/admin` — unauthenticated
visitors are redirected to `/admin`.

## How to use
1. Sign in to the admin and open **Email Snippets**.
2. Browse / search the property grid (search matches title, city, country).
3. Click a property. The tool generates:
   - a **live preview** (rendered from the exact HTML that gets copied), with a Desktop/Mobile toggle, and
   - the **HTML source** in a textarea.
4. Click **Copy HTML** → paste into Resend's broadcast composer.

## Data source
- Properties come from the same public endpoint the marketing homepage uses:
  `GET https://production-backend.swap-space.com/api/v1/properties/public`
  (CORS is already open; image URLs are permanent CloudFront URLs, so they survive in sent email).
- The email **"View listing"** button links to `https://app.swap-space.com/login`.
- The admin-only **"View listing page"** link opens `https://www.swap-space.com/Propertydetails?id={id}`
  so you can eyeball the public page; it is **not** part of the copied snippet.

## Email HTML constraints (followed by the generator)
Table-based layout, inline CSS only, 600px centered container, web-safe font stack,
absolute `https://` image `src`, `width`/`height` + `bgcolor` attributes for Outlook,
bulletproof `<a>`-in-`<td>` button, meaningful `alt` text. No `<style>` blocks,
JavaScript, forms, or CSS background images. The copied snippet is a standalone
`<table>` block with no `<html>`/`<head>`/`<body>` wrapper (Resend supplies those).

## Hero image cropping
Source photos vary in orientation — portrait phone photos (often with EXIF rotation)
made the card extremely tall. Email clients can't crop reliably (Outlook ignores CSS
`object-fit`; background-image cropping is unsupported), so the hero is cropped
server-side by **`/api/property-image`** (`api/property-image.js`):

- `sharp.rotate()` auto-orients via EXIF **first**, then a cover-resize produces an exact
  600×320 landscape (requested at 2× = 1200×640 for retina). Renders identically in every
  client and shrinks multi-MB photos to ~100 KB for deliverability.
- The endpoint only proxies our own image CDN (`d3vretalihqpwb.cloudfront.net`) to avoid
  becoming an open proxy, and caches each crop immutably at the edge (processed once).
- Adds `sharp` as a dependency (already supported on Vercel).

The crop URL is built in one place — `emailHeroSrc()` in `app.js`. The **copied snippet**
uses an absolute `https://www.swap-space.com/api/property-image…` URL so it works wherever
the email is opened; the **preview** rewrites that to the current origin so it also loads
during local dev. (Heads-up: if you generate a snippet on `localhost`, the copied image
URL still points at production — fine, since real sends are done from the deployed admin.)

## Known limitations
- One property per snippet (multi-property is a possible future addition).
- The catalogue endpoint returns published properties only; if it returns none,
  the tool shows an empty state.
- Description is truncated to ~180 characters for the card.
- Some listings have no host destinations in the public payload, so the card shows
  bedroom/bathroom/living-room counts and available swap months instead.
