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

    // ── GET /download/{fileId} ──
    // Streams the actual file from w.buzzheavier.com to the browser
    if (request.method === 'GET' && url.pathname.startsWith('/download/')) {
      const fileId  = url.pathname.replace('/download/', '').split('?')[0];

      // Try w.buzzheavier.com (CDN endpoint) first
      let upstream = await fetch(`https://w.buzzheavier.com/${fileId}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible)' },
      });

      // Fallback: buzzheavier.com direct
      if (!upstream.ok) {
        upstream = await fetch(`https://buzzheavier.com/${fileId}`, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
            'Accept'    : '*/*',
          },
          redirect: 'follow',
        });
      }

      if (!upstream.ok) {
        return new Response(JSON.stringify({ error: `upstream ${upstream.status}` }), {
          status : upstream.status,
          headers: { 'Content-Type': 'application/json', ...CORS },
        });
      }

      // Pass through the file stream with CORS headers
      const headers = new Headers(upstream.headers);
      Object.entries(CORS).forEach(([k, v]) => headers.set(k, v));
      // Ensure it triggers download in browser
      if (!headers.get('Content-Disposition')) {
        headers.set('Content-Disposition', `attachment`);
      }

      return new Response(upstream.body, { status: 200, headers });
    }

    // ── GET /page/{fileId} ──
    // Fetches buzzheavier HTML page with browser headers
    if (request.method === 'GET' && url.pathname.startsWith('/page/')) {
      const fileId  = url.pathname.replace('/page/', '').split('?')[0];

      const upstream = await fetch(`https://buzzheavier.com/${fileId}`, {
        headers: {
          'User-Agent'     : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept'         : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Cache-Control'  : 'no-cache',
        },
        redirect: 'follow',
      });

      const html = await upstream.text();
      return new Response(html, {
        status : upstream.status,
        headers: { 'Content-Type': 'text/html; charset=utf-8', ...CORS },
      });
    }

    return new Response('Not found', { status: 404 });
  },
};
