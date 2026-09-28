let mode = 'login';
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const forgotForm = document.getElementById('forgotForm');
const toggle = document.getElementById('toggleMode');
const forgotToggle = document.getElementById('forgotToggle');
const title = document.getElementById('formTitle');
const intro = document.getElementById('authIntro');
const msg = document.getElementById('msg');
const registrationMobile = document.getElementById('regMobile');

registrationMobile.addEventListener('input', () => {
  registrationMobile.value = registrationMobile.value.replace(/\D/g, '').slice(0, 10);
});

function showMode(newMode) {
  mode = newMode;
  title.textContent = mode === 'login' ? 'Login' : mode === 'register' ? 'Register' : 'Forgot login details';
  intro.textContent = mode === 'login'
    ? 'Sign in to practise MCQs, take timed tests, and review your progress.'
    : mode === 'register'
      ? 'Create an account to start practising and track your progress.'
      : 'Enter your registered email address to receive your login details.';
  loginForm.classList.toggle('hidden', mode !== 'login');
  registerForm.classList.toggle('hidden', mode !== 'register');
  forgotForm.classList.toggle('hidden', mode !== 'forgot');
  toggle.textContent = mode === 'register' ? 'Have an account? Login' : mode === 'forgot' ? 'Create an account' : 'Create an account';
  toggle.href = mode === 'register' ? '#login' : '#register';
  forgotToggle.textContent = mode === 'forgot' ? 'Back to login' : 'Forgot username or password?';
  forgotToggle.href = mode === 'forgot' ? '#login' : '#forgot';
  msg.textContent = '';
}

if (window.location.hash === '#register') showMode('register');

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
  if (!registerForm.reportValidity()) return;
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
  if (!forgotForm.reportValidity()) return;

  const submitButton = forgotForm.querySelector('button[type="submit"]');
  const email = document.getElementById('forgotEmail').value.trim();
  submitButton.disabled = true;
  msg.style.color = '#64747e';
  msg.textContent = 'Sending recovery instructions...';

  try {
    const { ok, data } = await submitJSON('/api/auth/forgot-password', { email });
    msg.style.color = ok ? '#287a50' : '';
    msg.textContent = ok
      ? (data.message || 'If that email is registered, recovery instructions have been sent.')
      : (data.error || 'We could not process your request. Please try again.');
    if (ok) forgotForm.reset();
  } catch {
    msg.style.color = '';
    msg.textContent = 'We could not reach the recovery service. Check your connection and try again.';
  } finally {
    submitButton.disabled = false;
  }
});

function redirectForRole(role) {
  if (new URLSearchParams(window.location.search).get('next') === 'materials') {
    window.location.href = '/index.html?tab=materials';
    return;
  }
  window.location.href = (role === 'admin' || role === 'master_admin') ? '/admin.html' : '/index.html';
}

// If already logged in, skip straight to the right screen
fetch('/api/auth/me').then(r => r.ok ? r.json() : null).then(d => {
  if (d && d.user) redirectForRole(d.user.role);
}).catch(() => {});
