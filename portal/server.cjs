'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const upstream = new URL(process.env.NAS_UPSTREAM || 'http://storage:8080');
if (upstream.protocol !== 'http:') throw new Error('NAS_UPSTREAM must use the internal HTTP network');
const home = fs.readFileSync(path.join(__dirname, 'index.html'));
const logo = fs.readFileSync(path.join(__dirname, 'logo.svg'));
const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://nas').pathname;
  const send = (status, type, data) => {
    res.writeHead(status, {'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin'});
    res.end(req.method === 'HEAD' ? undefined : data);
  };
  if (pathname === '/healthz') {
    try {
      const response = await fetch(new URL('/healthz', upstream), {signal: AbortSignal.timeout(3000), redirect: 'manual'});
      await response.arrayBuffer();
      return send(response.ok ? 200 : 503, 'application/json', JSON.stringify({status: response.ok ? 'ready' : 'starting'}));
    } catch { return send(503, 'application/json', '{"status":"starting"}'); }
  }
  if (pathname === '/' || pathname === '/logo.svg') {
    if (!['GET', 'HEAD'].includes(req.method)) return send(405, 'text/plain', 'Method not allowed');
    return send(200, pathname === '/' ? 'text/html; charset=utf-8' : 'image/svg+xml', pathname === '/' ? home : logo);
  }
  const shortShare = /^\/([A-Za-z0-9_-]{1,64})$/.exec(pathname);
  const reserved = new Set(['web','api','static','healthz','nas-login','lan-check']);
  if (shortShare && !reserved.has(shortShare[1].toLowerCase())) {
    if (!['GET','HEAD'].includes(req.method)) return send(405,'text/plain','Method not allowed');
    // Redirect keeps password-protected share cookies scoped to their native path.
    res.writeHead(302, {Location:'/web/client/pubshares/'+shortShare[1]+'/view'+new URL(req.url,'http://nas').search,'Cache-Control':'no-store'});
    return res.end();
  }
  // Never trust forwarded headers supplied by an arbitrary browser.
  const headers = {...req.headers};
  for (const key of Object.keys(headers)) {
    if (key.startsWith('x-forwarded-') || key.startsWith('x-nas-') || ['forwarded', 'cf-connecting-ip', 'connection', 'proxy-connection', 'proxy-authorization'].includes(key)) delete headers[key];
  }
  // Preserve the public Host for upstream CSRF checks and generated share URLs.
  const proxy = http.request({hostname: upstream.hostname, port: upstream.port || 80, path: req.url, method: req.method, headers}, response => {
    res.writeHead(response.statusCode, response.headers);
    response.on('error', () => res.destroy());
    response.pipe(res);
  });
  proxy.on('error', () => {
    if (res.headersSent) return res.destroy();
    send(503, 'text/plain; charset=utf-8', '存储服务正在启动，请稍后刷新。');
  });
  req.on('aborted', () => proxy.destroy());
  res.on('close', () => proxy.destroy());
  req.pipe(proxy);
});
server.requestTimeout = 0; // Large file uploads can take hours.
server.headersTimeout = 60000;
if (require.main === module) server.listen(Number(process.env.PORT || 8088), '0.0.0.0');
module.exports = server;
