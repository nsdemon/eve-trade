// Vercel serverless: handle all /api/* and pass through to Express app.
// Rewrite sends /api/:path* -> /api, so path becomes req.query.path; restore full URL for Express.
import app from '../server/index.js';

export default function handler(req, res) {
  // Restore path: Vercel adds captured :path* as query param "path"
  const path = req.query.path;
  if (path !== undefined) {
    const rest = { ...req.query };
    delete rest.path;
    const qs = new URLSearchParams(rest).toString();
    req.url = '/api/' + path + (qs ? '?' + qs : '');
  }
  return app(req, res);
}
