const ALLOWED_ROLES = ['admin', 'hrd', 'direktur', 'viewer'];

const INVITE_REDIRECT_URL =
  'https://website-hrd-al-fatih.vercel.app/reset-password.html';


function supabaseHeaders(secretKey) {
  return {
    apikey: secretKey,
    Authorization: `Bearer ${secretKey}`,
    'Content-Type': 'application/json'
  };
}


/* =========================================================
   VALIDASI MASTER
   ========================================================= */

async function getMasterAccount(req) {
  const token = (req.headers.authorization || '')
    .replace(/^Bearer\s+/i, '');

  if (!token) {
    throw new Error('Sesi login tidak ditemukan.');
  }

  const {
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_SECRET_KEY
  } = process.env;

  if (
    !SUPABASE_URL ||
    !SUPABASE_PUBLISHABLE_KEY ||
    !SUPABASE_SECRET_KEY
  ) {
    throw new Error('Konfigurasi Supabase belum lengkap.');
  }

  // Validasi token melalui Supabase Auth
  const userResponse = await fetch(
    `${SUPABASE_URL}/auth/v1/user`,
    {
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${token}`
      }
    }
  );

  if (!userResponse.ok) {
    throw new Error('Sesi login tidak valid.');
  }

  const user = await userResponse.json();

  // Ambil profile MASTER
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

  if (!profile.is_active) {
    throw new Error('Akun Anda sedang tidak aktif.');
  }

  if (
    profile.role !== 'master' ||
    profile.is_master !== true
  ) {
    const error = new Error(
      'Hanya MASTER yang dapat mengelola pengguna.'
    );

    error.statusCode = 403;

    throw error;
  }

  return {
    user,
    profile,
    SUPABASE_URL,
    SUPABASE_SECRET_KEY
  };
}


/* =========================================================
   GET ALL USERS
   ========================================================= */

async function getAllUsers(
  SUPABASE_URL,
  SUPABASE_SECRET_KEY
) {
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

    throw new Error(
      `Gagal mengambil daftar user Auth: ${text}`
    );
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

    throw new Error(
      `Gagal mengambil profiles: ${text}`
    );
  }

  const profiles = await profileResponse.json();

  const profileMap = new Map(
    profiles.map(profile => [
      profile.id,
      profile
    ])
  );

  return authUsers.map(authUser => {
    const profile = profileMap.get(authUser.id);

    return {
      id: authUser.id,
      email: authUser.email || '',
      full_name: profile?.full_name || '',
      role: profile?.role || 'viewer',
      is_master: profile?.is_master === true,
      is_active: profile?.is_active !== false,
      created_at:
        profile?.created_at ||
        authUser.created_at,
      last_sign_in_at:
        authUser.last_sign_in_at || null
    };
  });
}


/* =========================================================
   INVITE USER
   ========================================================= */

async function inviteUser({
  email,
  fullName,
  role,
  SUPABASE_URL,
  SUPABASE_SECRET_KEY
}) {
  const redirectUrl =
    encodeURIComponent(INVITE_REDIRECT_URL);

  const inviteResponse = await fetch(
    `${SUPABASE_URL}/auth/v1/invite?redirect_to=${redirectUrl}`,
    {
      method: 'POST',

      headers: supabaseHeaders(
        SUPABASE_SECRET_KEY
      ),

      body: JSON.stringify({
        email,

        data: {
          full_name: fullName,

          // Kita simpan juga role di metadata.
          // Trigger saat ini memang belum membacanya,
          // tetapi metadata ini berguna untuk pengembangan
          // berikutnya.
          application_role: role
        }
      })
    }
  );

  const inviteText =
    await inviteResponse.text();

  let invitePayload = {};

  try {
    invitePayload =
      JSON.parse(inviteText);
  } catch {
    // Payload bukan JSON.
  }

  if (!inviteResponse.ok) {
    throw new Error(
      invitePayload.msg ||
      invitePayload.message ||
      invitePayload.error_description ||
      invitePayload.error ||
      'Gagal mengirim invitation user.'
    );
  }

  return invitePayload;
}


/* =========================================================
   UPDATE PROFILE
   ========================================================= */

async function updateProfile({
  userId,
  fullName,
  role,
  SUPABASE_URL,
  SUPABASE_SECRET_KEY
}) {
  const profileResponse = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`,
    {
      method: 'PATCH',

      headers: {
        ...supabaseHeaders(
          SUPABASE_SECRET_KEY
        ),

        Prefer: 'return=representation'
      },

      body: JSON.stringify({
        full_name: fullName,
        role,
        is_master: false,
        is_active: true
      })
    }
  );

  const profileText =
    await profileResponse.text();

  let profilePayload = [];

  try {
    profilePayload =
      JSON.parse(profileText);
  } catch {
    // Payload bukan JSON.
  }

  if (!profileResponse.ok) {
    throw new Error(
      profilePayload.message ||
      profilePayload.hint ||
      profilePayload.details ||
      'Gagal memperbarui profile user.'
    );
  }

  if (!profilePayload[0]) {
    throw new Error(
      'User Auth berhasil dibuat, tetapi profile tidak ditemukan.'
    );
  }

  return profilePayload[0];
}


/* =========================================================
   DELETE AUTH USER
   ========================================================= */

async function deleteAuthUser(
  userId,
  SUPABASE_URL,
  SUPABASE_SECRET_KEY
) {
  const response = await fetch(
    `${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`,
    {
      method: 'DELETE',

      headers: {
        apikey: SUPABASE_SECRET_KEY,
        Authorization: `Bearer ${SUPABASE_SECRET_KEY}`
      }
    }
  );

  if (!response.ok) {
    console.error(
      'Gagal melakukan cleanup Auth user:',
      await response.text()
    );
  }
}


/* =========================================================
   API HANDLER
   ========================================================= */

module.exports = async function handler(
  req,
  res
) {
  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({
      error: 'Method tidak diizinkan.'
    });
  }

  try {
    const master =
      await getMasterAccount(req);


    /* =====================================================
       GET — DAFTAR USER
       ===================================================== */

    if (req.method === 'GET') {
      const users =
        await getAllUsers(
          master.SUPABASE_URL,
          master.SUPABASE_SECRET_KEY
        );

      return res.status(200).json({
        users
      });
    }


    /* =====================================================
       POST — BUAT / INVITE USER
       ===================================================== */

    const body =
      typeof req.body === 'string'
        ? JSON.parse(req.body || '{}')
        : (req.body || {});


    const email =
      String(body.email || '')
        .trim()
        .toLowerCase();

    const fullName =
      String(body.full_name || '')
        .trim();

    const role =
      String(body.role || 'viewer')
        .trim()
        .toLowerCase();


    /* VALIDASI EMAIL */

    if (!email) {
      return res.status(400).json({
        error: 'Email wajib diisi.'
      });
    }

    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
      return res.status(400).json({
        error: 'Format email tidak valid.'
      });
    }


    /* VALIDASI NAMA */

    if (!fullName) {
      return res.status(400).json({
        error: 'Nama lengkap wajib diisi.'
      });
    }


    /* VALIDASI ROLE */

    if (!ALLOWED_ROLES.includes(role)) {
      return res.status(400).json({
        error: 'Role tidak valid.'
      });
    }


    /* MASTER TIDAK BOLEH DIBUAT DARI ENDPOINT INI */

    if (role === 'master') {
      return res.status(400).json({
        error:
          'Role MASTER tidak dapat diberikan melalui pembuatan user.'
      });
    }


    /* =====================================================
       1. BUAT USER AUTH + KIRIM INVITATION
       ===================================================== */

    const invitedUser =
      await inviteUser({
        email,
        fullName,
        role,
        SUPABASE_URL:
          master.SUPABASE_URL,
        SUPABASE_SECRET_KEY:
          master.SUPABASE_SECRET_KEY
      });


    const userId =
      invitedUser?.id;


    if (!userId) {
      throw new Error(
        'Invitation berhasil diproses tetapi ID user tidak ditemukan.'
      );
    }


    /* =====================================================
       2. TRIGGER DATABASE OTOMATIS MEMBUAT PROFILE
       ===================================================== */

    /*
      handle_new_user() milik database Anda
      otomatis membuat:

      id
      full_name
      role = viewer

      Karena itu kita TIDAK melakukan INSERT.

      Kita tunggu sebentar agar trigger selesai,
      lalu PATCH profile tersebut.
    */

    await new Promise(resolve =>
      setTimeout(resolve, 300)
    );


    /* =====================================================
       3. UPDATE PROFILE SESUAI ROLE MASTER
       ===================================================== */

    try {
      await updateProfile({
        userId,
        fullName,
        role,
        SUPABASE_URL:
          master.SUPABASE_URL,
        SUPABASE_SECRET_KEY:
          master.SUPABASE_SECRET_KEY
      });

    } catch (profileError) {

      // Profile gagal diperbarui.
      // Hapus Auth user supaya tidak meninggalkan
      // akun setengah jadi.

      await deleteAuthUser(
        userId,
        master.SUPABASE_URL,
        master.SUPABASE_SECRET_KEY
      );

      throw profileError;
    }


    /* =====================================================
       4. BERHASIL
       ===================================================== */

    return res.status(201).json({
      success: true,

      message:
        'User berhasil dibuat dan invitation telah dikirim.',

      user: {
        id: userId,
        email,
        full_name: fullName,
        role,
        is_master: false,
        is_active: true
      }
    });

  } catch (error) {

    console.error(
      'User management API error:',
      error
    );

    return res.status(
      error.statusCode || 500
    ).json({
      error:
        error.message ||
        'Terjadi kesalahan pada User Management.'
    });
  }
};