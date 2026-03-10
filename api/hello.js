// Test endpoint: GET /api/hello should return 200. If this 404s, the api folder isn't deployed.
export default function handler(req, res) {
  res.status(200).json({ ok: true, message: 'API is working' });
}
