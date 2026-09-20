let mode = 'login';
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const forgotForm = document.getElementById('forgotForm');
const toggle = document.getElementById('toggleMode');
const forgotToggle = document.getElementById('forgotToggle');
const title = document.getElementById('formTitle');
const msg = document.getElementById('msg');

function showMode(newMode) {
  mode = newMode;
  title.textContent = mode === 'login' ? 'Login' : mode === 'register' ? 'Register' : 'Forgot login details';
  loginForm.classList.toggle('hidden', mode !== 'login');
  registerForm.classList.toggle('hidden', mode !== 'register');
  forgotForm.classList.toggle('hidden', mode !== 'forgot');
  toggle.textContent = mode === 'register' ? 'Have an account? Login' : 'Need an account? Register';
  msg.textContent = '';
}

toggle.addEventListener('click', (e) => {
  e.preventDefault();
  showMode(mode === 'register' ? 'login' : 'register');
});
forgotToggle.addEventListener('click', (e) => {
  e.preventDefault();
  showMode(mode === 'forgot' ? 'login' : 'forgot');
});

async function submitJSON(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  return { ok: res.ok, data };
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  msg.textContent = '';
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;
  const { ok, data } = await submitJSON('/api/auth/login', { username, password });
  if (!ok) { msg.textContent = data.error || 'Something went wrong'; return; }
  redirectForRole(data.user.role);
});

registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  msg.textContent = '';
  const body = {
    name: document.getElementById('regName').value.trim(),
    username: document.getElementById('regUsername').value.trim(),
    mobile: document.getElementById('regMobile').value.trim(),
    email: document.getElementById('regEmail').value.trim(),
    password: document.getElementById('regPassword').value,
    confirmPassword: document.getElementById('regConfirmPassword').value
  };
  const { ok, data } = await submitJSON('/api/auth/register', body);
  if (!ok) { msg.textContent = data.error || 'Something went wrong'; return; }
  redirectForRole(data.user.role);
});

forgotForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  msg.textContent = '';
  const email = document.getElementById('forgotEmail').value.trim();
  const { ok, data } = await submitJSON('/api/auth/forgot-password', { email });
  msg.style.color = ok ? '#2ecc71' : '';
  msg.textContent = data.message || data.error || 'Something went wrong';
  if (ok) forgotForm.reset();
});

function redirectForRole(role) {
  window.location.href = (role === 'admin' || role === 'master_admin') ? '/admin.html' : '/index.html';
}

// If already logged in, skip straight to the right screen
fetch('/api/auth/me').then(r => r.ok ? r.json() : null).then(d => {
  if (d && d.user) redirectForRole(d.user.role);
}).catch(() => {});
