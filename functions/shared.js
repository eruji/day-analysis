/* shared.js — Netlify Function: store / fetch / delete a shared dataset.
 *
 * Datasets live in a Netlify Blob store and are identified by a random id
 * that doubles as the access secret (the share link contains it, so only
 * people with the link can read the CSV back). The id is NOT guessable.
 *
 *   GET    /.netlify/functions/shared?id=<id>   -> { name, csv, at }
 *   POST   /.netlify/functions/shared  { csv, name } -> { ok, id }
 *   DELETE /.netlify/functions/shared?id=<id>   -> { ok }
 */
import { getStore } from '@netlify/blobs';

const STORE = 'shared-datasets';
const MAX_CSV = 5 * 1024 * 1024; // 5 MB per dataset
const MAX_NAME = 150;

const store = () => getStore({ name: STORE });

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

export default async (req) => {
  const url = new URL(req.url);
  const id = (url.searchParams.get('id') || '').trim();

  try {
    if (req.method === 'GET') {
      if (!id) return json({ error: 'missing id' }, 400);
      const rec = await store().get(id, { type: 'json' });
      if (!rec || typeof rec.csv !== 'string') return json({ error: 'not found' }, 404);
      return json({ id, name: rec.name || 'shared.csv', csv: rec.csv, at: rec.at || 0 });
    }

    if (req.method === 'POST') {
      let body;
      try { body = await req.json(); } catch (e) { body = null; }
      const csv = body && typeof body.csv === 'string' ? body.csv : '';
      if (!csv.trim() || csv.length > MAX_CSV) {
        return json({ error: 'missing or too-large csv (max ' + (MAX_CSV / 1048576) + ' MB)' }, 400);
      }
      const key = crypto.randomUUID().replace(/-/g, '').slice(0, 20);
      await store().set(key, {
        v: 1,
        name: String(body.name || 'shared.csv').slice(0, MAX_NAME),
        csv,
        at: Date.now()
      });
      return json({ ok: true, id: key });
    }

    if (req.method === 'DELETE') {
      if (!id) return json({ error: 'missing id' }, 400);
      await store().delete(id);
      return json({ ok: true });
    }

    return json({ error: 'method not allowed' }, 405);
  } catch (e) {
    console.error('shared fn error:', e);
    return json({ error: 'server error' }, 500);
  }
};
