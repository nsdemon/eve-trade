// Vercel serverless: handle all /api/* and pass through to Express app.
// Rewrite: /api/(.*) -> /api?path=$1 so we restore req.url for Express.
import app from '../server/index.js';

export default function handler(req, res) {
  const path = req.query.path;
  if (path !== undefined && path !== '') {
    const rest = { ...req.query };
    delete rest.path;
    const qs = new URLSearchParams(rest).toString();
    req.url = '/api/' + path + (qs ? '?' + qs : '');
  } else if (!req.url || req.url === '/api' || req.url.startsWith('/api?')) {
    req.url = req.url || '/api';
  }
  return app(req, res);
}
