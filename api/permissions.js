const PERMISSION_DEFINITIONS = [
  { key: 'dashboard.view', label: 'Dashboard', roles: ['master', 'admin', 'hrd', 'direktur', 'viewer'] },
  { key: 'program.view', label: 'Lihat Program', roles: ['master', 'admin', 'hrd', 'direktur', 'viewer'] },
  { key: 'program.create', label: 'Buat Program', roles: ['master', 'admin', 'hrd'] },
  { key: 'program.update', label: 'Update Program', roles: ['master', 'admin', 'hrd'] },
  { key: 'program.approve', label: 'Approval Program', roles: ['master', 'admin', 'direktur'] },
  { key: 'notulensi.view', label: 'Lihat Notulensi', roles: ['master', 'admin', 'hrd', 'direktur', 'viewer'] },
  { key: 'notulensi.manage', label: 'Kelola Notulensi', roles: ['master', 'admin', 'hrd', 'direktur'] },
  { key: 'master_data.manage', label: 'Master Data', roles: ['master', 'admin'] },
  { key: 'users.manage', label: 'Manajemen User', roles: ['master'] },
  { key: 'permissions.manage', label: 'Role & Permission', roles: ['master'] }
];

function supabaseHeaders(secretKey) {
  return {
    apikey: secretKey,
    Authorization: `Bearer ${secretKey}`,
    'Content-Type': 'application/json'
  };
}

async function getMasterAccount(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) throw new Error('Sesi login tidak ditemukan.');

  const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY || !SUPABASE_SECRET_KEY) {
    throw new Error('Konfigurasi Supabase belum lengkap.');
  }

  const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}` }
  });
  if (!userResponse.ok) throw new Error('Sesi login tidak valid.');
  const user = await userResponse.json();

  const profileResponse = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=id,full_name,role,is_master,is_active`,
    { headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}` } }
  );
  if (!profileResponse.ok) throw new Error('Profil pengguna tidak dapat dibaca.');
  const profiles = await profileResponse.json();
  const profile = profiles[0];
  if (!profile) throw new Error('Profil pengguna tidak ditemukan.');
  if (!profile.is_active) throw new Error('Akun Anda sedang tidak aktif.');

  if (profile.role !== 'master' || profile.is_master !== true) {
    const error = new Error('Hanya MASTER yang dapat mengelola Role & Permission.');
    error.statusCode = 403;
    throw error;
  }

  return { user, profile, SUPABASE_URL, SUPABASE_SECRET_KEY };
}

async function getTargetProfile(userId, SUPABASE_URL, SUPABASE_SECRET_KEY) {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=id,full_name,role,is_master,is_active`,
    { headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}` } }
  );
  if (!response.ok) throw new Error('Gagal membaca profile user.');
  const rows = await response.json();
  return rows[0] || null;
}

async function getOverrides(userId, SUPABASE_URL, SUPABASE_SECRET_KEY) {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/user_permissions?user_id=eq.${encodeURIComponent(userId)}&select=permission_key,allowed,updated_at&order=permission_key.asc`,
    { headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}` } }
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gagal mengambil permission user: ${text || 'database menolak permintaan.'}`);
  }
  return response.json();
}

function buildPermissionRows(role, overrides) {
  const map = new Map((overrides || []).map(item => [item.permission_key, item]));
  return PERMISSION_DEFINITIONS.map(def => {
    const defaultAllowed = def.roles.includes(role);
    const overrideItem = map.get(def.key);
    const override = overrideItem ? overrideItem.allowed === true : null;
    return {
      permission_key: def.key,
      label: def.label,
      default_allowed: defaultAllowed,
      override,
      effective_allowed: overrideItem ? override : defaultAllowed
    };
  });
}

module.exports = async function handler(req, res) {
  if (!['GET', 'PUT'].includes(req.method)) {
    return res.status(405).json({ error: 'Method tidak diizinkan.' });
  }

  try {
    const master = await getMasterAccount(req);

    if (req.method === 'GET') {
      const userId = String(req.query?.user_id || '').trim();
      if (!userId) return res.status(400).json({ error: 'user_id wajib diisi.' });

      const target = await getTargetProfile(userId, master.SUPABASE_URL, master.SUPABASE_SECRET_KEY);
      if (!target) return res.status(404).json({ error: 'User tidak ditemukan.' });

      const overrides = await getOverrides(userId, master.SUPABASE_URL, master.SUPABASE_SECRET_KEY);
      return res.status(200).json({
        user: target,
        permissions: buildPermissionRows(target.role, overrides)
      });
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const userId = String(body.user_id || '').trim();
    if (!userId) return res.status(400).json({ error: 'user_id wajib diisi.' });
    if (userId === master.user.id) return res.status(403).json({ error: 'Akun MASTER utama tidak dapat diubah.' });

    const target = await getTargetProfile(userId, master.SUPABASE_URL, master.SUPABASE_SECRET_KEY);
    if (!target) return res.status(404).json({ error: 'User tidak ditemukan.' });
    if (target.is_master === true || target.role === 'master') {
      return res.status(403).json({ error: 'Akun MASTER utama tidak dapat diubah.' });
    }

    const overrides = body.overrides;
    if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
      return res.status(400).json({ error: 'Format overrides tidak valid.' });
    }

    const validKeys = new Set(PERMISSION_DEFINITIONS.map(item => item.key));
    for (const [key, value] of Object.entries(overrides)) {
      if (!validKeys.has(key)) return res.status(400).json({ error: `Permission tidak valid: ${key}` });
      if (value !== null && typeof value !== 'boolean') {
        return res.status(400).json({ error: `Nilai permission tidak valid: ${key}` });
      }
    }

    for (const [key, value] of Object.entries(overrides)) {
      if (value === null) {
        const response = await fetch(
          `${master.SUPABASE_URL}/rest/v1/user_permissions?user_id=eq.${encodeURIComponent(userId)}&permission_key=eq.${encodeURIComponent(key)}`,
          { method: 'DELETE', headers: supabaseHeaders(master.SUPABASE_SECRET_KEY) }
        );
        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Gagal menghapus override ${key}: ${text || 'database menolak permintaan.'}`);
        }
      } else {
        const response = await fetch(`${master.SUPABASE_URL}/rest/v1/user_permissions`, {
          method: 'POST',
          headers: {
            ...supabaseHeaders(master.SUPABASE_SECRET_KEY),
            Prefer: 'resolution=merge-duplicates,return=minimal'
          },
          body: JSON.stringify({ user_id: userId, permission_key: key, allowed: value, updated_at: new Date().toISOString() })
        });
        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Gagal menyimpan override ${key}: ${text || 'database menolak permintaan.'}`);
        }
      }
    }

    const saved = await getOverrides(userId, master.SUPABASE_URL, master.SUPABASE_SECRET_KEY);
    return res.status(200).json({ success: true, message: 'Permission berhasil disimpan.', permissions: buildPermissionRows(target.role, saved) });
  } catch (error) {
    console.error('Role & Permission API error:', error);
    return res.status(error.statusCode || 500).json({ error: error.message || 'Terjadi kesalahan pada Role & Permission.' });
  }
};
