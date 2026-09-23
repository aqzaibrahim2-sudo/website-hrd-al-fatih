const WRITE_ROLES = ['admin', 'hrd'];
const APPROVAL_ROLES = ['admin', 'direktur'];

async function getAccount(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) throw new Error('Sesi login tidak ditemukan.');
  const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY } = process.env;
  const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}` }
  });
  if (!userResponse.ok) throw new Error('Sesi login tidak valid.');
  const user = await userResponse.json();
  const profileResponse = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=full_name,role`, {
    headers: { apikey: SUPABASE_SECRET_KEY }
  });
  const profiles = await profileResponse.json();
  if (!profileResponse.ok || !profiles[0]) throw new Error('Profil pengguna tidak ditemukan.');
  return { user, profile: profiles[0] };
}

module.exports = async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method tidak diizinkan.' });
  const { APPS_SCRIPT_URL, APPS_SCRIPT_SHARED_SECRET, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY } = process.env;
  if (![APPS_SCRIPT_URL, APPS_SCRIPT_SHARED_SECRET, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY].every(Boolean)) {
    return res.status(500).json({ error: 'Konfigurasi server belum lengkap.' });
  }
  try {
    const account = await getAccount(req);
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const action = body.action || 'APPEND_ROW';
    if (req.method === 'POST' && action !== 'APPEND_ROW' && !APPROVAL_ROLES.includes(account.profile.role)) {
      return res.status(403).json({ error: 'Role Anda tidak dapat melakukan approval.' });
    }
    if (req.method === 'POST' && action === 'APPEND_ROW' && !WRITE_ROLES.includes(account.profile.role)) {
      return res.status(403).json({ error: 'Role Anda hanya dapat melihat dashboard.' });
    }
    let response;
    if (req.method === 'GET') {
      const target = new URL(APPS_SCRIPT_URL);
      target.searchParams.set('internalKey', APPS_SCRIPT_SHARED_SECRET);
      response = await fetch(target, { cache: 'no-store' });
    } else {
      response = await fetch(APPS_SCRIPT_URL, {
        method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ ...body, internalKey: APPS_SCRIPT_SHARED_SECRET })
      });
    }
    const text = await response.text();
    let payload; try { payload = JSON.parse(text); } catch { throw new Error('Apps Script mengirim respons tidak valid.'); }
    return res.status(response.ok ? 200 : 502).json(payload);
  } catch (error) {
    return res.status(401).json({ error: error.message || 'Akses ditolak.' });
  }
};
