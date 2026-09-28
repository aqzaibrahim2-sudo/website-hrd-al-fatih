let client;
let account = null;

const clientReady = (async () => {
  const configResponse = await fetch('/api/config', { cache: 'no-store' });
  if (!configResponse.ok) throw new Error('Konfigurasi Supabase belum tersedia.');

  const config = await configResponse.json();

  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');

  client = createClient(
    config.supabaseUrl,
    config.supabasePublishableKey
  );

  return client;
})();

const ready = (async () => {
  await clientReady;

  const { data: { session } } = await client.auth.getSession();

  if (!session) return null;

  const { data: profile, error } = await client
    .from('profiles')
    .select('full_name,role,is_master,is_active')
    .eq('id', session.user.id)
    .single();

  if (error || !profile) throw new Error('Profil akun belum tersedia.');

  if (!profile.is_active) {
    await client.auth.signOut();
    throw new Error('Akun Anda sedang tidak aktif. Hubungi MASTER untuk mengaktifkan kembali.');
  }

  let permissions = {};

  try {
    const token = session.access_token;
    const permissionResponse = await fetch('/api/permissions', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store'
    });

    if (permissionResponse.ok) {
      const permissionPayload = await permissionResponse.json();
      permissions = permissionPayload.effective || {};
    } else {
      console.warn('Permission user belum dapat dimuat.');
    }
  } catch (permissionError) {
    console.warn('Permission user gagal dimuat:', permissionError);
  }

  account = { session, profile, permissions };
  return account;
})();

function can(permission) {
  const permissions = account?.permissions || {};

  const aliases = {
    write: ['program_create', 'program_update'],
    approve: ['program_approve'],
    dashboard: ['dashboard_view'],
    program: ['program_view'],
    notulensi: ['notulensi_view'],
    masterData: ['master_data_view'],
    users: ['user_management_manage'],
    rolePermission: ['role_permission_manage']
  };

  const keys = aliases[permission] || [permission];

  if (account?.profile?.is_master === true) {
    return true;
  }

  return keys.some(key => permissions[key] === true);
}

window.HRDAuth = {
  ready,
  clientReady,
  can,

  isMaster() {
    return account?.profile?.is_master === true;
  },

  async getAccessToken() {
    const result = await client.auth.getSession();
    return result.data.session?.access_token || '';
  },

  async requestPasswordReset(email) {
    await clientReady;

    return client.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password.html`
    });
  },

  async updatePassword(password) {
    await clientReady;

    return client.auth.updateUser({
      password
    });
  },

  async signOut() {
    if (client) await client.auth.signOut();
    window.location.replace('/login.html');
  }
};

document.addEventListener('DOMContentLoaded', async () => {
  const loginForm = document.getElementById('loginForm');
  const isResetPasswordPage = document.body.dataset.page === 'reset-password';

  if (isResetPasswordPage) {
    try {
      await clientReady;
    } catch (error) {
      console.error('Supabase initialization error:', error);
    }
    return;
  }

  loginForm?.addEventListener('submit', async event => {
    event.preventDefault();

    const button = loginForm.querySelector('button[type="submit"]');
    const loginError = document.getElementById('loginError');

    button.disabled = true;
    loginError.textContent = '';

    try {
      await clientReady;

      const { error } = await client.auth.signInWithPassword({
        email: loginForm.email.value.trim(),
        password: loginForm.password.value
      });

      if (error) {
        loginError.textContent = 'Email atau password tidak valid.';
        button.disabled = false;
        return;
      }

      const { data: { user: signedInUser } } = await client.auth.getUser();
      const { data: profile, error: profileError } = await client
        .from('profiles')
        .select('is_active')
        .eq('id', signedInUser?.id || '')
        .single();

      if (profileError || !profile) {
        await client.auth.signOut();
        loginError.textContent = 'Profil akun belum tersedia.';
        button.disabled = false;
        return;
      }

      if (!profile.is_active) {
        await client.auth.signOut();
        loginError.textContent = 'Akun Anda sedang tidak aktif. Hubungi MASTER untuk mengaktifkan kembali.';
        button.disabled = false;
        return;
      }

      window.location.replace('/');

    } catch (error) {
      console.error('Login error:', error);
      loginError.textContent = 'Terjadi kesalahan saat login. Silakan coba lagi.';
      button.disabled = false;
    }
  });

  try {
    const current = await ready;

    if (loginForm && current) {
      window.location.replace('/');
      return;
    }

    if (!loginForm && !current) {
      window.location.replace('/login.html');
      return;
    }

    if (!current) {
      return;
    }

    document.getElementById('accountName')?.append(
      `${current.profile.full_name || current.session.user.email}`
    );

    document.getElementById('accountRole')?.append(current.profile.role);

    document.querySelectorAll('[data-role="write"]')
      .forEach(el => el.classList.toggle('hidden', !can('write')));

  } catch (error) {
    console.error('Authentication error:', error);

    if (!loginForm) {
      window.location.replace('/login.html');
      return;
    }

    document.getElementById('loginError')?.append(error.message);
  }
});