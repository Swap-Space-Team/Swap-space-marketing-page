// On-the-fly hero image cropper for property email snippets.
//
// Property photos come from phones with arbitrary orientation + EXIF rotation,
// which makes email cards inconsistent (portrait photos render very tall) and
// can't be cropped reliably in email clients (Outlook ignores CSS object-fit).
// We crop here instead: sharp.rotate() auto-orients via EXIF *first*, then a
// cover-resize produces an exact landscape image that renders identically in
// every client — and shrinks multi-MB photos to ~100KB for deliverability.
//
// Results are immutable per URL, so we cache hard at the CDN: each unique crop
// is processed once and served from the edge thereafter.

import sharp from 'sharp';

// Only our own image CDN may be proxied (prevents this becoming an open proxy / SSRF).
const ALLOWED_HOST = 'd3vretalihqpwb.cloudfront.net';
const MAX_DIM = 2400;

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).send('Method not allowed');

  const rawUrl = req.query.url;
  if (!rawUrl) return res.status(400).send('Missing url');

  const clean = String(rawUrl).replace(/^https?:\/\//, '');
  const host = clean.split('/')[0];
  if (host !== ALLOWED_HOST) return res.status(400).send('Image host not allowed');

  const w = clamp(parseInt(req.query.w, 10) || 1200, 1, MAX_DIM);
  const h = clamp(parseInt(req.query.h, 10) || 640, 1, MAX_DIM);

  try {
    const upstream = await fetch('https://' + clean);
    if (!upstream.ok) return res.status(502).send(`Upstream responded ${upstream.status}`);

    const input = Buffer.from(await upstream.arrayBuffer());
    const output = await sharp(input)
      .rotate()                                              // auto-orient by EXIF before cropping
      .resize(w, h, { fit: 'cover', position: 'attention' }) // crop to exact box, keep the interesting region
      .jpeg({ quality: 80, mozjpeg: true })
      .toBuffer();

    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=31536000, s-maxage=31536000, immutable');
    return res.status(200).send(output);
  } catch (err) {
    console.error('property-image error:', err);
    return res.status(500).send('Image processing failed');
  }
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}
