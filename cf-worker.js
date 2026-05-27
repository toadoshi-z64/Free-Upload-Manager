/**
 * Free Upload Manager — Cloudflare Worker
 * Hanterar både upload-proxy och download-page-proxy.
 *
 * Deploy: https://dash.cloudflare.com → Workers → Create Worker
 * Ändra ALLOWED_ORIGIN till din domän.
 */

const ALLOWED_ORIGIN = 'https://freeuploadmanager.org';

const CORS = {
  'Access-Control-Allow-Origin' : ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'PUT, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age'      : '86400',
};

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }

    // ── PUT /upload/{filename}?note=... ──
    // Proxies file upload to w.buzzheavier.com
    if (request.method === 'PUT' && url.pathname.startsWith('/upload/')) {
      const filename  = decodeURIComponent(url.pathname.replace('/upload/', ''));
      const note      = url.searchParams.get('note') || '';
      const noteParam = note ? `?note=${note}` : '';
      const buzzUrl   = `https://w.buzzheavier.com/${encodeURIComponent(filename)}${noteParam}`;

      const upstream = await fetch(buzzUrl, {
        method : 'PUT',
        headers: {
          'Content-Type': 'application/octet-stream',
          ...(request.headers.get('Authorization')
            ? { Authorization: request.headers.get('Authorization') }
            : {}),
        },
        body  : request.body,
        duplex: 'half',
      });

      const text = await upstream.text();
      return new Response(text, {
        status : upstream.status,
        headers: { 'Content-Type': 'application/json', ...CORS },
      });
    }

    // ── GET /page/{fileId} ──
    // Fetches buzzheavier's HTML download page server-side (bypasses their CORS block)
    if (request.method === 'GET' && url.pathname.startsWith('/page/')) {
      const fileId  = url.pathname.replace('/page/', '').split('?')[0];
      const buzzUrl = `https://buzzheavier.com/${fileId}`;

      const upstream = await fetch(buzzUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
          'Accept'    : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });

      const html = await upstream.text();
      return new Response(html, {
        status : upstream.status,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          ...CORS,
        },
      });
    }

    return new Response('Not found', { status: 404 });
  },
};
