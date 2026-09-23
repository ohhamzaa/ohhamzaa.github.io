// Contact form → Discord webhook.
// The webhook URL lives only in the DISCORD_WEBHOOK_URL environment variable
// (set in Vercel), never in the page or the repo.

const hits = new Map(); // ip -> [timestamps]  (per warm instance; a speed bump, not a wall)
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 3;

function clean(s, max) {
  return String(s == null ? '' : s)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, max);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const hook = process.env.DISCORD_WEBHOOK_URL;
  if (!hook) return res.status(503).json({ error: 'not_configured' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { body = {}; } }
  body = body || {};

  // honeypot: bots fill every field; pretend success so they move on
  if (body.company) return res.status(200).json({ ok: true });

  // submitted within ~2s of opening the form = almost certainly a bot
  const openedAt = Number(body.t) || 0;
  if (!openedAt || Date.now() - openedAt < 2000) return res.status(400).json({ error: 'too_fast' });

  const name = clean(body.name, 60);
  const contact = clean(body.contact, 80);
  const message = clean(body.message, 1500);
  if (message.length < 5) return res.status(400).json({ error: 'too_short' });

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) return res.status(429).json({ error: 'rate_limited' });
  recent.push(now);
  hits.set(ip, recent);

  const payload = {
    username: 'ohhamza.vercel.app',
    allowed_mentions: { parse: [] }, // never let a message ping @everyone / roles / users
    embeds: [{
      title: 'New message from your site',
      description: message,
      color: 0x7c5cff,
      fields: [
        { name: 'From', value: name || '—', inline: true },
        { name: 'Reply to', value: contact || '—', inline: true },
      ],
      timestamp: new Date().toISOString(),
    }],
  };

  try {
    const r = await fetch(hook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!r.ok) return res.status(502).json({ error: 'upstream' });
    return res.status(200).json({ ok: true });
  } catch (_) {
    return res.status(502).json({ error: 'upstream' });
  }
};
