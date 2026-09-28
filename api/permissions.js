const ALLOWED_ROLES = ['master', 'admin', 'hrd', 'direktur', 'viewer'];

const PERMISSION_DEFINITIONS = {
  dashboard_view: { label: 'Dashboard', description: 'Melihat Dashboard' },
  program_view: { label: 'Lihat Program', description: 'Melihat daftar program' },
  program_create: { label: 'Buat Program', description: 'Membuat program baru' },
  program_update: { label: 'Update Program', description: 'Memperbarui program' },
  program_approve: { label: 'Approval Program', description: 'Melakukan approval program' },
  notulensi_view: { label: 'Notulensi', description: 'Melihat/mengelola notulensi' },
  master_data_view: { label: 'Master Data', description: 'Mengakses Master Data' },
  user_management_manage: { label: 'Manajemen User', description: 'Mengelola pengguna' },
  role_permission_manage: { label: 'Role & Permission', description: 'Mengelola role dan permission' }
};

const ROLE_DEFAULTS = {
  master: Object.keys(PERMISSION_DEFINITIONS),
  admin: [
    'dashboard_view', 'program_view', 'program_create', 'program_update',
    'program_approve', 'notulensi_view', 'master_data_view'
  ],
  hrd: [
    'dashboard_view', 'program_view', 'program_create', 'program_update',
    'notulensi_view'
  ],
  direktur: [
    'dashboard_view', 'program_view', 'program_approve', 'notulensi_view'
  ],
  viewer: [
    'dashboard_view', 'program_view', 'notulensi_view'
  ]
};

function supabaseHeaders(secretKey) {
  return {
    apikey: secretKey,
    Authorization: `Bearer ${secretKey}`,
    'Content-Type': 'application/json'
  };
}

async function getAuthenticatedAccount(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) throw new Error('Sesi login tidak ditemukan.');

  const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY || !SUPABASE_SECRET_KEY) {
    throw new Error('Konfigurasi Supabase belum lengkap.');
  }

  const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${token}`
    }
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
  if (!ALLOWED_ROLES.includes(profile.role)) throw new Error('Role pengguna tidak valid.');

  return { user, profile, SUPABASE_URL, SUPABASE_SECRET_KEY };
}

async function getOverrides(userId, SUPABASE_URL, SUPABASE_SECRET_KEY) {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/user_permissions?user_id=eq.${encodeURIComponent(userId)}&select=permission_key,allowed`,
    { headers: { apikey: SUPABASE_SECRET_KEY, Authorization: `Bearer ${SUPABASE_SECRET_KEY}` } }
  );

  if (!response.ok) throw new Error('Gagal mengambil permission user.');
  return response.json();
}

function buildEffectivePermissions(role, overrides) {
  const effective = {};
  const defaults = new Set(ROLE_DEFAULTS[role] || []);

  for (const key of Object.keys(PERMISSION_DEFINITIONS)) {
    effective[key] = defaults.has(key);
  }

  for (const item of overrides) {
    if (Object.prototype.hasOwnProperty.call(effective, item.permission_key)) {
      effective[item.permission_key] = item.allowed === true;
    }
  }

  return effective;
}

async function getUserPermissionPayload(userId, master) {
  const targetResponse = await fetch(
    `${master.SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=id,full_name,role,is_master,is_active`,
    { headers: { apikey: master.SUPABASE_SECRET_KEY, Authorization: `Bearer ${master.SUPABASE_SECRET_KEY}` } }
  );

  if (!targetResponse.ok) throw new Error('Gagal membaca profile user.');
  const targets = await targetResponse.json();
  const target = targets[0];
  if (!target) {
    const error = new Error('User tidak ditemukan.');
    error.statusCode = 404;
    throw error;
  }

  const overrides = await getOverrides(userId, master.SUPABASE_URL, master.SUPABASE_SECRET_KEY);
  const roleDefaults = ROLE_DEFAULTS[target.role] || [];
  const effective = buildEffectivePermissions(target.role, overrides);

  return {
    user: target,
    permissions: PERMISSION_DEFINITIONS,
    role_defaults: roleDefaults,
    overrides: overrides.reduce((map, item) => {
      map[item.permission_key] = item.allowed === true ? 'allow' : 'deny';
      return map;
    }, {}),
    effective
  };
}

module.exports = async function handler(req, res) {
  if (!['GET', 'PUT'].includes(req.method)) {
    return res.status(405).json({ error: 'Method tidak diizinkan.' });
  }

  try {
    const account = await getAuthenticatedAccount(req);
    const isMaster = account.profile.is_master === true && account.profile.role === 'master';

    const queryUserId = String(req.query?.user_id || '').trim();
    const userId = queryUserId || account.user.id;

    // MASTER boleh melihat/mengatur user lain. User biasa hanya boleh membaca permission dirinya sendiri.
    if (!isMaster && userId !== account.user.id) {
      return res.status(403).json({ error: 'Akses permission user lain tidak diizinkan.' });
    }

    if (req.method === 'GET') {
      const payload = await getUserPermissionPayload(userId, account);
      return res.status(200).json(payload);
    }

    if (!isMaster) {
      return res.status(403).json({ error: 'Hanya MASTER yang dapat mengubah permission.' });
    }

    if (userId === account.user.id || account.profile.is_master === true) {
      const targetPayload = await getUserPermissionPayload(userId, account);
      if (targetPayload.user.is_master) {
        return res.status(403).json({ error: 'Permission MASTER utama mengikuti seluruh akses MASTER dan tidak dapat diubah.' });
      }
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const overrides = body.overrides && typeof body.overrides === 'object' ? body.overrides : null;

    if (!overrides) {
      return res.status(400).json({ error: 'Data permission tidak valid.' });
    }

    const current = await getUserPermissionPayload(userId, account);

    if (current.user.is_master || current.user.role === 'master') {
      return res.status(403).json({ error: 'Akun MASTER utama tidak dapat diubah permission-nya.' });
    }

    for (const key of Object.keys(overrides)) {
      if (!Object.prototype.hasOwnProperty.call(PERMISSION_DEFINITIONS, key)) {
        return res.status(400).json({ error: `Permission tidak dikenal: ${key}` });
      }
      if (!['default', 'allow', 'deny'].includes(overrides[key])) {
        return res.status(400).json({ error: `Nilai permission tidak valid untuk ${key}.` });
      }
    }

    for (const [key, value] of Object.entries(overrides)) {
      if (value === 'default') {
        const deleteResponse = await fetch(
          `${account.SUPABASE_URL}/rest/v1/user_permissions?user_id=eq.${encodeURIComponent(userId)}&permission_key=eq.${encodeURIComponent(key)}`,
          { method: 'DELETE', headers: supabaseHeaders(account.SUPABASE_SECRET_KEY) }
        );
        if (!deleteResponse.ok) throw new Error(`Gagal menghapus override permission ${key}.`);
        continue;
      }

      const upsertResponse = await fetch(`${account.SUPABASE_URL}/rest/v1/user_permissions`, {
        method: 'POST',
        headers: {
          ...supabaseHeaders(account.SUPABASE_SECRET_KEY),
          Prefer: 'resolution=merge-duplicates,return=minimal'
        },
        body: JSON.stringify({
          user_id: userId,
          permission_key: key,
          allowed: value === 'allow'
        })
      });

      if (!upsertResponse.ok) {
        const text = await upsertResponse.text();
        throw new Error(`Gagal menyimpan permission ${key}: ${text}`);
      }
    }

    const payload = await getUserPermissionPayload(userId, account);
    return res.status(200).json({ success: true, ...payload });

  } catch (error) {
    console.error('Permissions API error:', error);
    return res.status(error.statusCode || 500).json({
      error: error.message || 'Terjadi kesalahan pada permission.'
    });
  }
};
