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
    .select('full_name,role')
    .eq('id', session.user.id)
    .single();

  if (error || !profile) throw new Error('Profil akun belum tersedia.');

  account = { session, profile };
  return account;
})();

function can(permission) {
  const role = account?.profile?.role;
  return permission === 'write' ? ['admin', 'hrd'].includes(role) : permission === 'approve' ? ['admin', 'direktur'].includes(role) : Boolean(role);
}

window.HRDAuth = {
  ready,
  clientReady,
  can,

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