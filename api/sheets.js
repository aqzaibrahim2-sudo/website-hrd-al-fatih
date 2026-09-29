const ROLE_DEFAULTS = {
  'dashboard.view': ['master', 'admin', 'hrd', 'direktur', 'viewer'],
  'program.view': ['master', 'admin', 'hrd', 'direktur', 'viewer'],
  'program.create': ['master', 'admin', 'hrd'],
  'program.update': ['master', 'admin', 'hrd'],
  'program.approve': ['master', 'admin', 'direktur'],
  'notulensi.view': ['master', 'admin', 'hrd', 'direktur', 'viewer'],
  'notulensi.create': ['master', 'admin', 'hrd', 'direktur'],
  'notulensi.update': ['master', 'admin', 'hrd', 'direktur'],
  'master_data.view': ['master', 'admin'],
  'master_data.manage': ['master', 'admin'],
  'users.view': ['master'],
  'users.create': ['master'],
  'users.update': ['master'],
  'users.delete': ['master'],
  'users.manage_permissions': ['master']
};

function supabaseAdminHeaders(secretKey) {
  return { apikey: secretKey, Authorization: `Bearer ${secretKey}` };
}

async function getAccount(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    const error = new Error('Sesi login tidak ditemukan.');
    error.statusCode = 401;
    throw error;
  }

  const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY } = process.env;
  const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}` }
  });
  if (!userResponse.ok) {
    const error = new Error('Sesi login tidak valid.');
    error.statusCode = 401;
    throw error;
  }
  const user = await userResponse.json();

  const profileResponse = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=id,full_name,role,is_master,is_active,department_id`,
    { headers: supabaseAdminHeaders(SUPABASE_SECRET_KEY) }
  );
  if (!profileResponse.ok) throw new Error('Profil pengguna tidak dapat dibaca.');
  const profiles = await profileResponse.json();
  const profile = profiles[0];
  if (!profile) throw new Error('Profil pengguna tidak ditemukan.');
  if (profile.is_active === false) {
    const error = new Error('Akun Anda sedang tidak aktif. Hubungi MASTER untuk mengaktifkan kembali.');
    error.statusCode = 403;
    throw error;
  }
  const role = String(profile.role || '').toLowerCase();
  let department = null;
  if (role === 'hrd') {
    if (!profile.department_id) {
      const error = new Error('Akun HRD belum ditetapkan ke departemen. Hubungi MASTER.');
      error.statusCode = 403;
      throw error;
    }
    const departmentResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/departments?id=eq.${encodeURIComponent(profile.department_id)}&select=id,code,name,is_active&limit=1`,
      { headers: supabaseAdminHeaders(SUPABASE_SECRET_KEY) }
    );
    if (!departmentResponse.ok) throw new Error('Data departemen akun tidak dapat dibaca.');
    const departments = await departmentResponse.json();
    department = departments[0] || null;
    if (!department || department.is_active !== true) {
      const error = new Error('Departemen akun HRD tidak ditemukan atau tidak aktif. Hubungi MASTER.');
      error.statusCode = 403;
      throw error;
    }
  }
  return { user, profile, department };
}

async function getPermissionId(code, env) {
  const url = `${env.SUPABASE_URL}/rest/v1/permissions?code=eq.${encodeURIComponent(code)}&select=id&limit=1`;
  const response = await fetch(url, { headers: supabaseAdminHeaders(env.SUPABASE_SECRET_KEY) });
  if (!response.ok) throw new Error(`Gagal memeriksa katalog permission ${code}.`);
  const rows = await response.json();
  if (!rows[0]) throw new Error(`Permission ${code} belum terdaftar di database.`);
  return rows[0].id;
}

async function hasPermission(account, permissionCode, env) {
  const role = String(account.profile.role || '').toLowerCase();
  if (account.profile.is_master === true || role === 'master') return true;

  const allowedByRole = (ROLE_DEFAULTS[permissionCode] || []).includes(role);
  const permissionId = await getPermissionId(permissionCode, env);
  const url = `${env.SUPABASE_URL}/rest/v1/user_permissions?user_id=eq.${encodeURIComponent(account.user.id)}&permission_id=eq.${encodeURIComponent(permissionId)}&select=allowed&limit=1`;
  const response = await fetch(url, { headers: supabaseAdminHeaders(env.SUPABASE_SECRET_KEY) });
  if (!response.ok) throw new Error(`Gagal membaca override permission ${permissionCode}.`);
  const rows = await response.json();
  // An explicit false is a denial; true is an allow; no row means role default.
  return rows.length ? rows[0].allowed === true : allowedByRole;
}

function permissionForRequest(method, body) {
  if (method === 'GET') return 'program.view';
  const action = body.action || 'APPEND_ROW';
  if (action === 'RESERVE_PROGRAM_ID') return 'program.create';
  if (action === 'APPROVE_PROGRAM' || action === 'REJECT_PROGRAM') return 'program.approve';
  if (action !== 'APPEND_ROW') {
    const error = new Error(`Aksi tidak dikenali: ${action}`);
    error.statusCode = 400;
    throw error;
  }
  if (body.sheet === 'MASTER_PROGRAM') return 'program.create';
  if (body.sheet === 'UPDATE_MINGGUAN') return 'program.update';
  const error = new Error('Sheet tujuan tidak diizinkan.');
  error.statusCode = 400;
  throw error;
}

module.exports = async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ error: 'Method tidak diizinkan.' });
  }

  const env = process.env;
  const { APPS_SCRIPT_URL, APPS_SCRIPT_SHARED_SECRET, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY } = env;
  if (![APPS_SCRIPT_URL, APPS_SCRIPT_SHARED_SECRET, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY].every(Boolean)) {
    return res.status(500).json({ error: 'Konfigurasi server belum lengkap.' });
  }

  try {
    const account = await getAccount(req);
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const permissionCode = permissionForRequest(req.method, body);
    const allowed = await hasPermission(account, permissionCode, env);
    if (!allowed) {
      return res.status(403).json({
        error: `Akses ditolak. Permission ${permissionCode} tidak diizinkan untuk akun Anda.`
      });
    }

    const role = String(account.profile.role || '').toLowerCase();
    const isMaster = account.profile.is_master === true || role === 'master';
    const scope = {
      role: isMaster ? 'master' : role,
      departmentName: role === 'hrd' ? account.department.name : null,
      userId: account.user.id
    };

    let response;
    if (req.method === 'GET') {
      const target = new URL(APPS_SCRIPT_URL);
      target.searchParams.set('internalKey', APPS_SCRIPT_SHARED_SECRET);
      target.searchParams.set('scopeRole', scope.role);
      if (scope.departmentName) target.searchParams.set('scopeDepartment', scope.departmentName);
      response = await fetch(target, { cache: 'no-store' });
    } else {
      response = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        // Server-derived scope overrides any client-supplied context.
        body: JSON.stringify({ ...body, accessContext: scope, internalKey: APPS_SCRIPT_SHARED_SECRET })
      });
    }

    const text = await response.text();
    let payload;
    try { payload = JSON.parse(text); }
    catch { throw new Error('Apps Script mengirim respons tidak valid.'); }

    if (!response.ok || payload.success === false) {
      return res.status(response.ok ? 400 : 502).json(payload);
    }
    // Defense in depth: HRD data is scoped again at the Vercel boundary.
    if (req.method === 'GET' && role === 'hrd') {
      const allowedProgramIds = new Set((payload.MASTER_PROGRAM || [])
        .filter(program => String(program.DEPARTEMEN || '').trim() === account.department.name)
        .map(program => String(program.ID_PROGRAM || '')));
      payload.MASTER_PROGRAM = (payload.MASTER_PROGRAM || [])
        .filter(program => allowedProgramIds.has(String(program.ID_PROGRAM || '')));
      payload.UPDATE_MINGGUAN = (payload.UPDATE_MINGGUAN || [])
        .filter(update => allowedProgramIds.has(String(update.ID_PROGRAM || '')));
      payload.MASTER_DEPARTEMEN = [account.department.name];
      payload.accountScope = { role: 'hrd', departmentName: account.department.name };
    } else if (req.method === 'GET') {
      payload.accountScope = { role: isMaster ? 'master' : role, departmentName: null };
    }
    return res.status(200).json(payload);
  } catch (error) {
    return res.status(error.statusCode || 500).json({ error: error.message || 'Akses ditolak.' });
  }
};
