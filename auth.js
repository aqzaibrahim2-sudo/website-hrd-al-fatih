let client;
let account = null;
const ready = (async () => {
  const configResponse = await fetch('/api/config', { cache: 'no-store' });
  if (!configResponse.ok) throw new Error('Konfigurasi Supabase belum tersedia.');
  const config = await configResponse.json();
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
  client = createClient(config.supabaseUrl, config.supabasePublishableKey);
  const { data: { session } } = await client.auth.getSession();
  if (!session) return null;
  const { data: profile, error } = await client.from('profiles').select('full_name,role').eq('id', session.user.id).single();
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
  can,
  async getAccessToken() { const result = await client.auth.getSession(); return result.data.session?.access_token || ''; },
  async signOut() { if (client) await client.auth.signOut(); window.location.replace('/login.html'); }
};

document.addEventListener('DOMContentLoaded', async () => {
  const loginForm = document.getElementById('loginForm');
  try {
    const current = await ready;
    if (loginForm && current) return window.location.replace('/');
    if (!loginForm && !current) return window.location.replace('/login.html');
    if (!current) return;
    document.getElementById('accountName')?.append(`${current.profile.full_name || current.session.user.email}`);
    document.getElementById('accountRole')?.append(current.profile.role);
    document.querySelectorAll('[data-role="write"]').forEach(el => el.classList.toggle('hidden', !can('write')));
  } catch (error) {
    if (!loginForm) window.location.replace('/login.html');
    document.getElementById('loginError')?.append(error.message);
  }
  loginForm?.addEventListener('submit', async event => {
    event.preventDefault();
    const button = loginForm.querySelector('button[type="submit"]'); button.disabled = true;
    const { error } = await client.auth.signInWithPassword({ email: loginForm.email.value, password: loginForm.password.value });
    if (error) { document.getElementById('loginError').textContent = 'Email atau password tidak valid.'; button.disabled = false; return; }
    window.location.replace('/');
  });
});
