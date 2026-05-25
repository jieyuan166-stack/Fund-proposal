(function () {
  const RESET_EMAIL = 'jieyuan165@gmail.com';

  const style = document.createElement('style');
  style.textContent = `
    .triton-auth-overlay {
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      display: grid;
      place-items: center;
      padding: 24px;
      background:
        radial-gradient(circle at 18% 16%, rgba(201,168,76,.16), transparent 34%),
        linear-gradient(135deg, #071224 0%, #10243d 54%, #081426 100%);
      color: #eef4fb;
      font-family: Inter, "Noto Sans SC", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    .triton-auth-panel {
      width: min(420px, 100%);
      border: 1px solid rgba(201,168,76,.32);
      background: rgba(8,18,34,.92);
      box-shadow: 0 24px 80px rgba(0,0,0,.42);
      padding: 28px;
    }

    .triton-auth-logo {
      height: 44px;
      width: auto;
      margin-bottom: 22px;
      display: block;
    }

    .triton-auth-title {
      margin: 0 0 6px;
      font-size: 24px;
      font-weight: 700;
      letter-spacing: 0;
    }

    .triton-auth-copy {
      margin: 0 0 22px;
      color: #aebed2;
      font-size: 14px;
      line-height: 1.6;
    }

    .triton-auth-label {
      display: block;
      margin: 14px 0 8px;
      color: #d8e2ee;
      font-size: 13px;
      font-weight: 600;
    }

    .triton-auth-input {
      width: 100%;
      height: 44px;
      border: 1px solid rgba(216,226,238,.2);
      background: rgba(255,255,255,.08);
      color: #fff;
      padding: 0 12px;
      font-size: 15px;
      outline: none;
    }

    .triton-auth-input:focus {
      border-color: #c9a84c;
      box-shadow: 0 0 0 3px rgba(201,168,76,.16);
    }

    .triton-auth-button {
      width: 100%;
      height: 44px;
      margin-top: 18px;
      border: 0;
      background: #c9a84c;
      color: #071224;
      font-size: 15px;
      font-weight: 700;
      cursor: pointer;
    }

    .triton-auth-links {
      display: flex;
      gap: 12px;
      justify-content: space-between;
      align-items: center;
      margin-top: 14px;
      font-size: 13px;
    }

    .triton-auth-link {
      color: #e8d5a3;
      text-decoration: none;
      background: none;
      border: 0;
      padding: 0;
      cursor: pointer;
      font: inherit;
    }

    .triton-auth-error {
      min-height: 20px;
      margin-top: 12px;
      color: #ffb4b4;
      font-size: 13px;
      line-height: 1.45;
    }

    .triton-account-button {
      position: fixed;
      right: 14px;
      bottom: 14px;
      z-index: 2147483000;
      border: 1px solid rgba(201,168,76,.5);
      background: rgba(8,18,34,.88);
      color: #e8d5a3;
      padding: 9px 12px;
      font: 600 13px Inter, "Noto Sans SC", sans-serif;
      cursor: pointer;
      box-shadow: 0 12px 32px rgba(0,0,0,.22);
    }

    @media (max-width: 520px) {
      .triton-auth-panel { padding: 22px; }
      .triton-auth-title { font-size: 21px; }
      .triton-account-button { right: 10px; bottom: 10px; }
    }
  `;
  document.head.appendChild(style);

  function requestReset() {
    const subject = encodeURIComponent('proposal.tritonwealth.ca password reset');
    const body = encodeURIComponent('Hi Jie,\n\nI forgot the password for proposal.tritonwealth.ca. Please help me reset it.\n\nThanks.');
    window.location.href = `mailto:${RESET_EMAIL}?subject=${subject}&body=${body}`;
  }

  async function postJson(url, payload) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(payload || {})
    });
    const data = await response.json().catch(() => ({}));
    return { response, data };
  }

  function removeOverlay() {
    const existing = document.querySelector('.triton-auth-overlay');
    if (existing) existing.remove();
  }

  function showAccountButton() {
    if (window.top !== window.self || document.querySelector('.triton-account-button')) return;
    const button = document.createElement('button');
    button.className = 'triton-account-button';
    button.type = 'button';
    button.textContent = '账户';
    button.addEventListener('click', () => buildOverlay('change'));
    document.body.appendChild(button);
  }

  function panelHtml(mode) {
    const isChange = mode === 'change';
    return `
      <div class="triton-auth-panel" role="dialog" aria-modal="true" aria-labelledby="triton-auth-title">
        <img class="triton-auth-logo" src="/triton-logo.png" alt="Triton Wealth" onerror="this.style.display='none'">
        <h1 class="triton-auth-title" id="triton-auth-title">${isChange ? '更改密码' : '登录 Proposal'}</h1>
        <p class="triton-auth-copy">${isChange ? '设置一个新的全站访问密码。' : '请输入访问密码后继续查看富瑞财富方案。'}</p>
        ${isChange ? '<label class="triton-auth-label" for="triton-old-password">当前密码</label><input class="triton-auth-input" id="triton-old-password" type="password" autocomplete="current-password">' : ''}
        <label class="triton-auth-label" for="triton-password">${isChange ? '新密码' : '密码'}</label>
        <input class="triton-auth-input" id="triton-password" type="password" autocomplete="${isChange ? 'new-password' : 'current-password'}" autofocus>
        ${isChange ? '<label class="triton-auth-label" for="triton-confirm-password">确认新密码</label><input class="triton-auth-input" id="triton-confirm-password" type="password" autocomplete="new-password">' : ''}
        <button class="triton-auth-button" type="button" id="triton-submit">${isChange ? '保存新密码' : '登录'}</button>
        <div class="triton-auth-links">
          <button class="triton-auth-link" type="button" id="triton-forgot">忘记密码</button>
          ${isChange ? '<button class="triton-auth-link" type="button" id="triton-logout">退出登录</button>' : ''}
        </div>
        <div class="triton-auth-error" id="triton-error" role="status"></div>
      </div>
    `;
  }

  function buildOverlay(mode) {
    removeOverlay();
    const overlay = document.createElement('div');
    overlay.className = 'triton-auth-overlay';
    overlay.innerHTML = panelHtml(mode);
    document.body.appendChild(overlay);

    const password = overlay.querySelector('#triton-password');
    const submit = overlay.querySelector('#triton-submit');
    const error = overlay.querySelector('#triton-error');

    async function submitLogin() {
      error.textContent = '';
      const { response } = await postJson('/api/login', { password: password.value });
      if (!response.ok) {
        error.textContent = '密码不正确，请重试。';
        password.select();
        return;
      }
      window.location.reload();
    }

    async function submitChange() {
      const oldPassword = overlay.querySelector('#triton-old-password');
      const confirm = overlay.querySelector('#triton-confirm-password');
      error.textContent = '';

      if (password.value.length < 8) {
        error.textContent = '新密码至少需要 8 个字符。';
        password.focus();
        return;
      }
      if (password.value !== confirm.value) {
        error.textContent = '两次输入的新密码不一致。';
        confirm.select();
        return;
      }

      const { response, data } = await postJson('/api/change-password', {
        currentPassword: oldPassword.value,
        newPassword: password.value
      });

      if (!response.ok) {
        error.textContent = data.error === 'INVALID_CURRENT_PASSWORD' ? '当前密码不正确。' : '密码更新失败，请稍后再试。';
        return;
      }
      removeOverlay();
    }

    submit.addEventListener('click', mode === 'change' ? submitChange : submitLogin);
    overlay.querySelector('#triton-forgot').addEventListener('click', requestReset);
    const logout = overlay.querySelector('#triton-logout');
    if (logout) {
      logout.addEventListener('click', async () => {
        await postJson('/api/logout');
        window.location.href = '/';
      });
    }
    overlay.addEventListener('keydown', event => {
      if (event.key === 'Enter') submit.click();
      if (event.key === 'Escape' && mode === 'change') removeOverlay();
    });
    setTimeout(() => (overlay.querySelector('#triton-old-password') || password).focus(), 0);
  }

  async function bootAuth() {
    const response = await fetch('/api/auth-status', { credentials: 'same-origin' }).catch(() => null);
    const data = response ? await response.json().catch(() => ({})) : {};
    if (data.authenticated) {
      showAccountButton();
      return;
    }
    buildOverlay('login');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootAuth);
  } else {
    bootAuth();
  }
})();
