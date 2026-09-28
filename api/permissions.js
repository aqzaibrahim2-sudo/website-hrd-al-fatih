const PERMISSION_DEFINITIONS = [
  { key: 'dashboard.view', label: 'Lihat Dashboard', roles: ['master', 'admin', 'hrd', 'direktur', 'viewer'] },
  { key: 'program.view', label: 'Lihat Program', roles: ['master', 'admin', 'hrd', 'direktur', 'viewer'] },
  { key: 'program.create', label: 'Buat Program', roles: ['master', 'admin', 'hrd'] },
  { key: 'program.update', label: 'Update Program', roles: ['master', 'admin', 'hrd'] },
  { key: 'program.approve', label: 'Approval Program', roles: ['master', 'admin', 'direktur'] },
  { key: 'notulensi.view', label: 'Lihat Notulensi', roles: ['master', 'admin', 'hrd', 'direktur', 'viewer'] },
  { key: 'notulensi.create', label: 'Buat Notulensi', roles: ['master', 'admin', 'hrd', 'direktur'] },
  { key: 'notulensi.update', label: 'Update Notulensi', roles: ['master', 'admin', 'hrd', 'direktur'] },
  { key: 'master_data.view', label: 'Lihat Master Data', roles: ['master', 'admin'] },
  { key: 'master_data.manage', label: 'Kelola Master Data', roles: ['master', 'admin'] },
  { key: 'users.view', label: 'Lihat User', roles: ['master'] },
  { key: 'users.create', label: 'Buat User', roles: ['master'] },
  { key: 'users.update', label: 'Update User', roles: ['master'] },
  { key: 'users.delete', label: 'Hapus User', roles: ['master'] },
  { key: 'users.manage_permissions', label: 'Kelola Permission', roles: ['master'] }
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
    `${SUPABASE_URL}/rest/v1/user_permissions?user_id=eq.${encodeURIComponent(userId)}&select=permission_id,allowed,created_at&order=permission_id.asc`,
    { headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}` } }
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gagal mengambil permission user: ${text || 'database menolak permintaan.'}`);
  }
  return response.json();
}

function buildPermissionRows(role, overrides, permissionRows) {
  const map = new Map((overrides || []).map(item => [String(item.permission_id), item]));
  const idByKey = new Map((permissionRows || []).map(item => [item.code, item.id]));
  return PERMISSION_DEFINITIONS.map(def => {
    const defaultAllowed = def.roles.includes(role);
    const overrideItem = map.get(def.key);
    const override = overrideItem ? overrideItem.allowed === true : null;
    return {
      permission_key: def.key,
      permission_id: idByKey.get(def.key) ?? null,
      label: def.label,
      default_allowed: defaultAllowed,
      override,
      effective_allowed: overrideItem ? override : defaultAllowed
    };
  });
}

async function getPermissionCatalog(SUPABASE_URL, SUPABASE_SECRET_KEY) {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/permissions?select=id,code,name,module&order=module.asc,id.asc`,
    { headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}` } }
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gagal mengambil daftar permission: ${text || 'database menolak permintaan.'}`);
  }
  return response.json();
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

      const [overrides, catalog] = await Promise.all([
        getOverrides(userId, master.SUPABASE_URL, master.SUPABASE_SECRET_KEY),
        getPermissionCatalog(master.SUPABASE_URL, master.SUPABASE_SECRET_KEY)
      ]);
      const catalogByCode = new Map(catalog.map(item => [item.code, item]));
      const missing = PERMISSION_DEFINITIONS.filter(def => !catalogByCode.has(def.key));
      if (missing.length) {
        throw new Error(`Permission belum tersedia di database: ${missing.map(item => item.key).join(', ')}`);
      }
      return res.status(200).json({
        user: target,
        permissions: buildPermissionRows(target.role, overrides, catalog)
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

    const catalog = await getPermissionCatalog(master.SUPABASE_URL, master.SUPABASE_SECRET_KEY);
    const idByKey = new Map(catalog.map(item => [item.code, item.id]));
    const validKeys = new Set(PERMISSION_DEFINITIONS.map(item => item.key));
    for (const [key, value] of Object.entries(overrides)) {
      if (!validKeys.has(key)) return res.status(400).json({ error: `Permission tidak valid: ${key}` });
      if (value !== null && typeof value !== 'boolean') {
        return res.status(400).json({ error: `Nilai permission tidak valid: ${key}` });
      }
      if (!idByKey.has(key)) {
        return res.status(400).json({ error: `Permission belum terdaftar di database: ${key}` });
      }
    }

    for (const [key, value] of Object.entries(overrides)) {
      const permissionId = idByKey.get(key);
      const filter = `user_id=eq.${encodeURIComponent(userId)}&permission_id=eq.${encodeURIComponent(permissionId)}`;

      if (value === null) {
        const response = await fetch(
          `${master.SUPABASE_URL}/rest/v1/user_permissions?${filter}`,
          { method: 'DELETE', headers: supabaseHeaders(master.SUPABASE_SECRET_KEY) }
        );
        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Gagal menghapus override ${key}: ${text || 'database menolak permintaan.'}`);
        }
      } else {
        const existingResponse = await fetch(
          `${master.SUPABASE_URL}/rest/v1/user_permissions?${filter}&select=user_id,permission_id`,
          { headers: { apikey: master.SUPABASE_SECRET_KEY, Authorization: `Bearer ${master.SUPABASE_SECRET_KEY}` } }
        );
        if (!existingResponse.ok) {
          const text = await existingResponse.text();
          throw new Error(`Gagal memeriksa override ${key}: ${text || 'database menolak permintaan.'}`);
        }
        const existing = await existingResponse.json();
        if (existing.length) {
          const response = await fetch(
            `${master.SUPABASE_URL}/rest/v1/user_permissions?${filter}`,
            {
              method: 'PATCH',
              headers: { ...supabaseHeaders(master.SUPABASE_SECRET_KEY), Prefer: 'return=minimal' },
              body: JSON.stringify({ allowed: value })
            }
          );
          if (!response.ok) {
            const text = await response.text();
            throw new Error(`Gagal memperbarui override ${key}: ${text || 'database menolak permintaan.'}`);
          }
        } else {
          const response = await fetch(`${master.SUPABASE_URL}/rest/v1/user_permissions`, {
            method: 'POST',
            headers: { ...supabaseHeaders(master.SUPABASE_SECRET_KEY), Prefer: 'return=minimal' },
            body: JSON.stringify({ user_id: userId, permission_id: permissionId, allowed: value })
          });
          if (!response.ok) {
            const text = await response.text();
            throw new Error(`Gagal menyimpan override ${key}: ${text || 'database menolak permintaan.'}`);
          }
        }
      }
    }

    const saved = await getOverrides(userId, master.SUPABASE_URL, master.SUPABASE_SECRET_KEY);
    return res.status(200).json({ success: true, message: 'Permission berhasil disimpan.', permissions: buildPermissionRows(target.role, saved, catalog) });
  } catch (error) {
    console.error('Role & Permission API error:', error);
    return res.status(error.statusCode || 500).json({ error: error.message || 'Terjadi kesalahan pada Role & Permission.' });
  }
};
