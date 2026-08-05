const http  = require('http');
const https = require('https');
const { URL } = require('url');

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://freeuploadmanager.org';
const PORT           = process.env.PORT || 3000;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin' : ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'PUT, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-File-Size',
  'Access-Control-Max-Age'      : '86400',
};

function sendJSON(res, status, obj) {
  if (res.headersSent) return;
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json', ...CORS_HEADERS });
  res.end(body);
}

const server = http.createServer((req, res) => {
  let base;
  try {
    base = `http://${req.headers.host}`;
  } catch (_) {
    return sendJSON(res, 400, { error: 'Bad request' });
  }

  const url = new URL(req.url, base);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  // ── Upload proxy → BuzzHeavier ──────────────────────────────────────────
  if (req.method === 'PUT' && url.pathname.startsWith('/api/upload/')) {
    const filename = decodeURIComponent(url.pathname.replace('/api/upload/', ''));
    const buzzPath = '/' + encodeURIComponent(filename) +
                     (url.searchParams.get('note') ? '?note=' + url.searchParams.get('note') : '');

    const upstreamOpts = {
      hostname: 'w.buzzheavier.com',
      path    : buzzPath,
      method  : 'PUT',
      headers : {
        'Content-Type': req.headers['content-type'] || 'application/octet-stream',
      },
    };

    const cl = parseInt(req.headers['content-length'], 10);
    if (!isNaN(cl) && cl > 0) {
      upstreamOpts.headers['Content-Length'] = cl;
    }

    if (req.headers['authorization']) {
      upstreamOpts.headers['Authorization'] = req.headers['authorization'];
    }

    let responded = false;
    const safeError = (status, msg) => {
      if (responded) return;
      responded = true;
      sendJSON(res, status, { error: msg });
    };

    const buzzReq = https.request(upstreamOpts, buzzRes => {
      let body = '';
      buzzRes.on('data', chunk => { body += chunk; });
      buzzRes.on('end', () => {
        if (responded) return;
        responded = true;
        res.writeHead(buzzRes.statusCode, {
          'Content-Type': 'application/json',
          ...CORS_HEADERS,
        });
        res.end(body);
      });
      buzzRes.on('error', err => {
        console.error('BuzzHeavier response error:', err.message);
        safeError(502, 'Upstream response error: ' + err.message);
      });
    });

    // Timeout på 10 minuter för stora filer
    buzzReq.setTimeout(600000, () => {
      console.error('BuzzHeavier request timed out');
      buzzReq.destroy();
      safeError(504, 'Upload timed out');
    });

    buzzReq.on('error', err => {
      console.error('BuzzHeavier error:', err.message);
      safeError(502, 'Upstream error: ' + err.message);
    });

    req.on('error', err => {
      console.error('Client request error:', err.message);
      buzzReq.destroy(err);
    });

    req.on('aborted', () => {
      console.warn('Client aborted upload');
      buzzReq.destroy();
    });

    // Pipe med backpressure
    req.pipe(buzzReq, { end: true });
    return;
  }

  // ── Page proxy → BuzzHeavier (/page/<fileId>) ───────────────────────────
  if (req.method === 'GET' && url.pathname.startsWith('/page/') && !url.pathname.startsWith('/page/fd')) {
    const fileId = url.pathname.replace('/page/', '').split('?')[0];

    const opts = {
      hostname: 'buzzheavier.com',
      path    : '/' + fileId,
      method  : 'GET',
      headers : {
        'User-Agent'     : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept'         : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    };

    const buzzReq = https.request(opts, buzzRes => {
      if (buzzRes.statusCode >= 300 && buzzRes.statusCode < 400 && buzzRes.headers.location) {
        res.writeHead(302, { Location: buzzRes.headers.location, ...CORS_HEADERS });
        res.end();
        return;
      }

      if (buzzRes.statusCode !== 200) {
        sendJSON(res, buzzRes.statusCode, { error: buzzRes.statusCode });
        return;
      }

      let html = '';
      buzzRes.on('data', chunk => { html += chunk; });
      buzzRes.on('end', () => {
        html = html
          .replace(/(href|src|action)="\/(?!\/)/g,  '$1="https://buzzheavier.com/')
          .replace(/(href|src|action)='\/(?!\/)/g,  "$1='https://buzzheavier.com/")
          .replace(/url\(\/(?!\/)/g,                 'url(https://buzzheavier.com/')
          .replace(/hx-(get|post|put|delete)="\/(?!\/)/g, 'hx-$1="https://buzzheavier.com/');

        const inject = `<style>
          html, body { background-color: #0d0d0d !important; margin: 0; padding: 8px; }
          .navbar { display: none !important; }
          .text-danger { display: none !important; }
          #preview { display: none !important; }
          .text-center.text-danger { display: none !important; }
        </style>`;
        html = html.includes('<head>') ? html.replace('<head>', '<head>' + inject) : inject + html;

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...CORS_HEADERS });
        res.end(html);
      });
    });

    buzzReq.setTimeout(30000, () => { buzzReq.destroy(); sendJSON(res, 504, { error: 'Timeout' }); });
    buzzReq.on('error', err => sendJSON(res, 502, { error: err.message }));
    buzzReq.end();
    return;
  }

  // ── Page proxy → FileDitch (/page/fd?url=...) ───────────────────────────
  if (req.method === 'GET' && url.pathname === '/page/fd') {
    const target = url.searchParams.get('url') || '';

    if (!target || !target.includes('fileditch')) {
      sendJSON(res, 400, { error: 'Only FileDitch URLs are allowed' });
      return;
    }

    let targetUrl;
    try {
      targetUrl = new URL(target);
    } catch (_) {
      sendJSON(res, 400, { error: 'Invalid URL' });
      return;
    }

    const opts = {
      hostname: targetUrl.hostname,
      path    : targetUrl.pathname + targetUrl.search,
      method  : 'GET',
      headers : {
        'User-Agent'     : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept'         : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    };

    const fdReq = https.request(opts, fdRes => {
      if (fdRes.statusCode >= 300 && fdRes.statusCode < 400 && fdRes.headers.location) {
        res.writeHead(302, { Location: fdRes.headers.location, ...CORS_HEADERS });
        res.end();
        return;
      }

      if (fdRes.statusCode !== 200) {
        sendJSON(res, fdRes.statusCode, { error: 'FileDitch returned ' + fdRes.statusCode });
        return;
      }

      let html = '';
      fdRes.on('data', chunk => { html += chunk; });
      fdRes.on('end', () => {
        const base = targetUrl.origin;
        html = html
          .replace(/(href|src|action)="\/(?!\/)/g,  `$1="${base}/`)
          .replace(/(href|src|action)='\/(?!\/)/g,  `$1='${base}/`)
          .replace(/url\(\/(?!\/)/g,                 `url(${base}/`);

        const cleanStyle = `<style>
          body { margin: 0; padding: 12px; background: #0d0d0d !important; }
          body > *:not(.wrap) { display: none !important; }
          .wrap > *:not(.controls) { display: none !important; }
          .controls {
            display: flex !important;
            gap: 8px;
            flex-wrap: wrap;
          }
        </style>`;
        html = html.includes('</head>')
          ? html.replace('</head>', cleanStyle + '</head>')
          : cleanStyle + html;

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...CORS_HEADERS });
        res.end(html);
      });
    });

    fdReq.setTimeout(30000, () => { fdReq.destroy(); sendJSON(res, 504, { error: 'Timeout' }); });
    fdReq.on('error', err => {
      console.error('FileDitch proxy error:', err.message);
      sendJSON(res, 502, { error: err.message });
    });

    fdReq.end();
    return;
  }

  // ── Healthcheck ──────────────────────────────────────────────────────────
  if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname === '/ping') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }

  sendJSON(res, 404, { error: 'Not found' });
});

server.on('connection', socket => {
  socket.setKeepAlive(true, 30000);
});

// Fånga upp oväntade fel så att processen inte kraschar
process.on('uncaughtException', err => {
  console.error('Uncaught exception:', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

server.listen(PORT, () => {
  console.log(`FUM proxy listening on port ${PORT}`);
});
