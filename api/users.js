async function getMasterAccount(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');

  if (!token) {
    throw new Error('Sesi login tidak ditemukan.');
  }

  const {
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_SECRET_KEY
  } = process.env;

  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY || !SUPABASE_SECRET_KEY) {
    throw new Error('Konfigurasi Supabase belum lengkap.');
  }

  // Validasi session user melalui Supabase Auth
  const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${token}`
    }
  });

  if (!userResponse.ok) {
    throw new Error('Sesi login tidak valid.');
  }

  const user = await userResponse.json();

  // Ambil profile dengan secret key karena ini operasi server-side
  const profileResponse = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=id,full_name,role,is_master,is_active`,
    {
      headers: {
        apikey: SUPABASE_SECRET_KEY,
        Authorization: `Bearer ${SUPABASE_SECRET_KEY}`
      }
    }
  );

  if (!profileResponse.ok) {
    throw new Error('Profil pengguna tidak dapat dibaca.');
  }

  const profiles = await profileResponse.json();
  const profile = profiles[0];

  if (!profile) {
    throw new Error('Profil pengguna tidak ditemukan.');
  }

  // MASTER harus aktif
  if (!profile.is_active) {
    throw new Error('Akun Anda sedang tidak aktif.');
  }

  // Hanya MASTER yang boleh mengakses API User Management
  if (profile.role !== 'master' || profile.is_master !== true) {
    const error = new Error('Hanya MASTER yang dapat mengelola pengguna.');
    error.statusCode = 403;
    throw error;
  }

  return {
    user,
    profile
  };
}


async function getAllUsers() {
  const {
    SUPABASE_URL,
    SUPABASE_SECRET_KEY
  } = process.env;

  // Ambil user dari Supabase Auth
  const authResponse = await fetch(
    `${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=1000`,
    {
      headers: {
        apikey: SUPABASE_SECRET_KEY,
        Authorization: `Bearer ${SUPABASE_SECRET_KEY}`
      }
    }
  );

  if (!authResponse.ok) {
    const text = await authResponse.text();
    throw new Error(`Gagal mengambil daftar user Auth: ${text}`);
  }

  const authPayload = await authResponse.json();
  const authUsers = authPayload.users || [];

  // Ambil profile aplikasi
  const profileResponse = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?select=id,full_name,role,is_master,is_active,created_at,updated_at&order=created_at.asc`,
    {
      headers: {
        apikey: SUPABASE_SECRET_KEY,
        Authorization: `Bearer ${SUPABASE_SECRET_KEY}`
      }
    }
  );

  if (!profileResponse.ok) {
    const text = await profileResponse.text();
    throw new Error(`Gagal mengambil profiles: ${text}`);
  }

  const profiles = await profileResponse.json();

  const profileMap = new Map(
    profiles.map(profile => [profile.id, profile])
  );

  // Gabungkan Auth User + Profile
  return authUsers.map(authUser => {
    const profile = profileMap.get(authUser.id);

    return {
      id: authUser.id,
      email: authUser.email || '',
      full_name: profile?.full_name || '',
      role: profile?.role || 'viewer',
      is_master: profile?.is_master === true,
      is_active: profile?.is_active !== false,
      created_at: profile?.created_at || authUser.created_at,
      last_sign_in_at: authUser.last_sign_in_at || null
    };
  });
}


module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({
      error: 'Method tidak diizinkan.'
    });
  }

  try {
    await getMasterAccount(req);

    const users = await getAllUsers();

    return res.status(200).json({
      users
    });
  } catch (error) {
    console.error('User management API error:', error);

    return res.status(error.statusCode || 401).json({
      error: error.message || 'Akses ditolak.'
    });
  }
};