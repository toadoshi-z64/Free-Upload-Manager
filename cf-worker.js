/**
 * Free Upload Manager — Cloudflare Worker Upload Proxy
 *
 * Deploy på: https://dash.cloudflare.com → Workers → Create Worker
 * Klistra in denna kod → Deploy
 * Notera din worker-URL (t.ex. fum-proxy.dittnamn.workers.dev)
 * Uppdatera WORKER_URL i index.html
 */

const ALLOWED_ORIGIN = 'https://freeuploadmanager.org';
const BUZZHEAVIER_UPLOAD = 'https://w.buzzheavier.com';

export default {
  async fetch(request, env) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
          'Access-Control-Allow-Methods': 'PUT, GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Filename',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    const url = new URL(request.url);

    // ── PUT /upload/{filename} → forward to w.buzzheavier.com ──
    if (request.method === 'PUT' && url.pathname.startsWith('/upload/')) {
      const filename = url.pathname.replace('/upload/', '');
      const note     = url.searchParams.get('note') || '';
      const noteParam = note ? `?note=${note}` : '';

      const buzzUrl = `${BUZZHEAVIER_UPLOAD}/${filename}${noteParam}`;

      // Forward the request body to buzzheavier
      const upstream = await fetch(buzzUrl, {
        method : 'PUT',
        headers : {
          'Content-Type': 'application/octet-stream',
          ...(request.headers.get('Authorization')
            ? { 'Authorization': request.headers.get('Authorization') }
            : {}),
        },
        body: request.body,
        // Important: disable duplex streaming limit
        duplex: 'half',
      });

      const text = await upstream.text();

      return new Response(text, {
        status: upstream.status,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
        },
      });
    }

    return new Response('Not found', { status: 404 });
  },
};
