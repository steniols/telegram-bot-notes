import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import { CATEGORIES } from './categories.js';

const page = readFileSync(new URL('../public/dashboard.html', import.meta.url));

function authorized(url, token) {
  if (!token) return true;
  const given = Buffer.from(url.searchParams.get('token') ?? '');
  const expected = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function startDashboard({ db, host, port, token }) {
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (!authorized(url, token)) {
      res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('Não autorizado. Acesse com ?token=SEU_TOKEN');
    }
    if (url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      return res.end(page);
    }
    if (url.pathname === '/api/items') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ categories: CATEGORIES, items: db.listAll() }));
    }
    res.writeHead(404).end();
  });
  server.listen(port, host, () => console.log(`Dashboard em http://${host}:${port}${token ? '/?token=...' : ''}`));
  return server;
}
