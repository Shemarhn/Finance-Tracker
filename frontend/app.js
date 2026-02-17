// ============================================================
// FINANCETRACKER — Frontend Application
// Vanilla JS — No framework dependencies
// ============================================================

(() => {
  'use strict';

  // ============================================================
  // CONFIGURATION
  // ============================================================
  const CONFIG = {
    // CHANGE THIS to your n8n instance webhook base URL
    API_BASE: 'https://n8n.crocodile-barley.ts.net/webhook',
    // PayPal Subscription Plan IDs (set these up in PayPal Developer Dashboard)
    PAYPAL_MONTHLY_PLAN_ID: 'P-XXXXXXXXXXXXXXXXXXXXXXXXXX',
    PAYPAL_YEARLY_PLAN_ID: 'P-YYYYYYYYYYYYYYYYYYYYYYYYYY',
    PAYPAL_CLIENT_ID: 'YOUR_PAYPAL_CLIENT_ID',
    // Endpoints
    ENDPOINTS: {
      register: '/finance/auth/register',
      login: '/finance/auth/login',
      message: '/finance/api/message',
      ocr: '/finance/api/ocr',
      accounts: '/finance/api/accounts',
      transactions: '/finance/api/transactions',
      summary: '/finance/api/summary',
      subscription: '/finance/api/subscription',
      editTransaction: '/finance/api/edit-transaction',
    },
  };

  // ============================================================
  // STATE
  // ============================================================
  const state = {
    token: localStorage.getItem('ft_token') || null,
    user: JSON.parse(localStorage.getItem('ft_user') || 'null'),
    currentView: 'chat',
    txnPage: 0,
    txnLimit: 20,
    selectedImage: null,
  };

  // ============================================================
  // INITIALIZATION
  // ============================================================
  document.addEventListener('DOMContentLoaded', () => {
    if (state.token && state.user) {
      showApp();
    } else {
      showAuth();
    }
  });

  // ============================================================
  // API HELPER
  // ============================================================
  async function api(endpoint, options = {}) {
    const url = CONFIG.API_BASE + endpoint;
    const headers = { 'Content-Type': 'application/json', ...options.headers };

    if (state.token) {
      headers['Authorization'] = `Bearer ${state.token}`;
    }

    try {
      const response = await fetch(url, { ...options, headers });
      const data = await response.json();

      if (response.status === 401) {
        handleLogout();
        showToast('Session expired. Please login again.', 'error');
        throw new Error('Unauthorized');
      }

      return data;
    } catch (error) {
      if (error.message !== 'Unauthorized') {
        console.error('API Error:', error);
        showToast('Connection error. Check your network.', 'error');
      }
      throw error;
    }
  }

  // ============================================================
  // AUTH FUNCTIONS
  // ============================================================
  window.handleLogin = async function (e) {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const btn = document.getElementById('login-btn');

    setLoading(btn, true);
    hideAuthError();

    try {
      const data = await api(CONFIG.ENDPOINTS.login, {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });

      if (data.success) {
        state.token = data.token;
        state.user = data.user;
        localStorage.setItem('ft_token', data.token);
        localStorage.setItem('ft_user', JSON.stringify(data.user));
        showApp();
        showToast('Welcome back, ' + data.user.first_name + '!', 'success');
      } else {
        showAuthError(data.error || 'Login failed');
      }
    } catch (err) {
      showAuthError('Connection error. Is the backend running?');
    }

    setLoading(btn, false);
    return false;
  };

  window.handleRegister = async function (e) {
    e.preventDefault();
    const first_name = document.getElementById('reg-first').value.trim();
    const last_name = document.getElementById('reg-last').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const password = document.getElementById('reg-password').value;
    const btn = document.getElementById('register-btn');

    setLoading(btn, true);
    hideAuthError();

    try {
      const data = await api(CONFIG.ENDPOINTS.register, {
        method: 'POST',
        body: JSON.stringify({ email, password, first_name, last_name }),
      });

      if (data.success) {
        state.token = data.token;
        state.user = data.user;
        localStorage.setItem('ft_token', data.token);
        localStorage.setItem('ft_user', JSON.stringify(data.user));
        showApp();
        showToast('Account created! Welcome, ' + data.user.first_name + '!', 'success');
      } else {
        showAuthError(data.error || 'Registration failed');
      }
    } catch (err) {
      showAuthError('Connection error. Is the backend running?');
    }

    setLoading(btn, false);
    return false;
  };

  window.handleLogout = function () {
    state.token = null;
    state.user = null;
    localStorage.removeItem('ft_token');
    localStorage.removeItem('ft_user');
    showAuth();
  };

  window.showLogin = function () {
    document.getElementById('login-form').classList.add('active');
    document.getElementById('register-form').classList.remove('active');
    hideAuthError();
  };

  window.showRegister = function () {
    document.getElementById('login-form').classList.remove('active');
    document.getElementById('register-form').classList.add('active');
    hideAuthError();
  };

  function showAuth() {
    document.getElementById('auth-screen').classList.add('active');
    document.getElementById('app-screen').classList.remove('active');
  }

  function showApp() {
    document.getElementById('auth-screen').classList.remove('active');
    document.getElementById('app-screen').classList.add('active');
    if (state.user) {
      document.getElementById('user-name').textContent = state.user.first_name || 'User';
    }
    loadDashboard();
    loadSubscription();
  }

  function showAuthError(msg) {
    const el = document.getElementById('auth-error');
    el.textContent = msg;
    el.classList.remove('hidden');
  }

  function hideAuthError() {
    document.getElementById('auth-error').classList.add('hidden');
  }

  // ============================================================
  // VIEW SWITCHING
  // ============================================================
  window.switchView = function (view) {
    state.currentView = view;

    // Update nav
    document.querySelectorAll('.nav-item').forEach((item) => {
      item.classList.toggle('active', item.dataset.view === view);
    });

    // Update views
    document.querySelectorAll('.view').forEach((v) => {
      v.classList.toggle('active', v.id === `view-${view}`);
    });

    // Load data for view
    switch (view) {
      case 'dashboard':
        loadDashboard();
        break;
      case 'transactions':
        loadTransactions();
        break;
      case 'accounts':
        loadAccounts();
        break;
      case 'subscription':
        loadSubscription();
        break;
    }
  };

  // ============================================================
  // CHAT
  // ============================================================
  window.sendMessage = async function (e) {
    e.preventDefault();
    const input = document.getElementById('message-input');
    const message = input.value.trim();
    if (!message && !state.selectedImage) return;

    // Add user message to chat
    if (message) {
      addChatMessage(message, 'user');
    }

    input.value = '';
    const sendBtn = document.getElementById('send-btn');
    sendBtn.disabled = true;

    // Show typing indicator
    const typingEl = addTypingIndicator();

    try {
      if (state.selectedImage) {
        // OCR upload
        addChatMessage('📷 Uploading receipt for OCR...', 'user');
        const data = await api(CONFIG.ENDPOINTS.ocr, {
          method: 'POST',
          body: JSON.stringify({ image: state.selectedImage, message }),
        });
        removeTypingIndicator(typingEl);
        addChatMessage(data.message || data.note || 'Image received.', 'bot');
        removeImage();
      } else {
        // Regular message
        const data = await api(CONFIG.ENDPOINTS.message, {
          method: 'POST',
          body: JSON.stringify({ message }),
        });

        removeTypingIndicator(typingEl);

        if (data.success) {
          addChatMessage(data.message, 'bot');

          // If transactions were logged, show details
          if (data.transactions && data.transactions.length > 0) {
            const txDetail = data.transactions
              .map(
                (t) =>
                  `${t.direction === 'inflow' ? '💵' : '💸'} ${t.item}: ${formatJMD(t.amount)} (${t.category})`
              )
              .join('\n');
            addChatMessage(txDetail, 'bot');
          }

          // If data has summary info
          if (data.data && data.data.total_income !== undefined) {
            // Dashboard update (background)
            loadDashboard();
          }
        } else if (data.upgrade_required) {
          addChatMessage(
            '⭐ ' + data.error + '\n\nGo to Plan tab to upgrade.',
            'bot'
          );
        } else {
          addChatMessage(
            data.error || data.message || 'Something went wrong.',
            'bot'
          );
        }
      }
    } catch (err) {
      removeTypingIndicator(typingEl);
      addChatMessage(
        'Sorry, I had trouble connecting. Please try again.',
        'bot'
      );
    }

    sendBtn.disabled = false;
    input.focus();
    return false;
  };

  function addChatMessage(text, sender) {
    const container = document.getElementById('chat-messages');
    const msgEl = document.createElement('div');
    msgEl.className = `message ${sender}`;

    const contentEl = document.createElement('div');
    contentEl.className = 'message-content';

    // Parse simple formatting
    const formatted = text
      .split('\n')
      .map((line) => `<p>${escapeHtml(line)}</p>`)
      .join('');
    contentEl.innerHTML = formatted;

    msgEl.appendChild(contentEl);
    container.appendChild(msgEl);
    container.scrollTop = container.scrollHeight;
  }

  function addTypingIndicator() {
    const container = document.getElementById('chat-messages');
    const el = document.createElement('div');
    el.className = 'message bot typing';
    el.innerHTML =
      '<div class="message-content"><div class="typing-indicator"><span></span><span></span><span></span></div></div>';
    container.appendChild(el);
    container.scrollTop = container.scrollHeight;
    return el;
  }

  function removeTypingIndicator(el) {
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  // ============================================================
  // IMAGE UPLOAD
  // ============================================================
  window.handleImageSelect = function (e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (ev) {
      state.selectedImage = ev.target.result;
      document.getElementById('preview-img').src = ev.target.result;
      document.getElementById('image-preview').classList.remove('hidden');
    };
    reader.readAsDataURL(file);
  };

  window.removeImage = function () {
    state.selectedImage = null;
    document.getElementById('image-preview').classList.add('hidden');
    document.getElementById('image-input').value = '';
  };

  // ============================================================
  // DASHBOARD
  // ============================================================
  async function loadDashboard() {
    try {
      const [summaryData, accountsData] = await Promise.all([
        api(CONFIG.ENDPOINTS.summary + '?period=week'),
        api(CONFIG.ENDPOINTS.accounts),
      ]);

      if (summaryData.success && summaryData.summary) {
        const s = summaryData.summary;
        document.getElementById('dash-income').textContent = formatJMD(
          s.total_income || 0
        );
        document.getElementById('dash-expense').textContent = formatJMD(
          s.total_expense || 0
        );
        document.getElementById('dash-net').textContent = formatJMD(
          (s.total_income || 0) - (s.total_expense || 0)
        );
        document.getElementById('dash-count').textContent = s.tx_count || 0;
      }

      if (accountsData.success && accountsData.accounts) {
        renderAccountsList(
          accountsData.accounts,
          document.getElementById('dash-accounts')
        );
      }

      // Load recent transactions
      const txData = await api(
        CONFIG.ENDPOINTS.transactions + '?limit=5&offset=0'
      );
      if (txData.success && txData.transactions) {
        renderTxnList(
          txData.transactions,
          document.getElementById('dash-recent-txns'),
          false
        );
      }
    } catch (err) {
      console.error('Dashboard load error:', err);
    }
  }

  // ============================================================
  // TRANSACTIONS
  // ============================================================
  window.loadTransactions = async function (dir) {
    if (dir === 'next') state.txnPage++;
    else if (dir === 'prev' && state.txnPage > 0) state.txnPage--;

    const offset = state.txnPage * state.txnLimit;

    try {
      const data = await api(
        `${CONFIG.ENDPOINTS.transactions}?limit=${state.txnLimit}&offset=${offset}`
      );
      if (data.success) {
        renderTxnList(
          data.transactions,
          document.getElementById('transactions-list'),
          true
        );
        document.getElementById('txn-page-info').textContent =
          `Page ${state.txnPage + 1}`;
        document.getElementById('txn-prev').disabled = state.txnPage === 0;
        document.getElementById('txn-next').disabled =
          data.transactions.length < state.txnLimit;
      }
    } catch (err) {
      console.error('Transactions load error:', err);
    }
  };

  function renderTxnList(txns, container, showActions) {
    if (!txns || txns.length === 0) {
      container.innerHTML =
        '<p class="empty-state">No transactions yet. Start by sending a message!</p>';
      return;
    }

    container.innerHTML = txns
      .map(
        (tx) => `
      <div class="txn-item" data-id="${tx.id}">
        <div class="txn-left">
          <span class="txn-item-name">${escapeHtml(tx.item)}</span>
          <span class="txn-meta">${tx.category} · ${tx.payment_method || 'unknown'} · ${formatDate(tx.created_at)}</span>
        </div>
        <div class="txn-right">
          <span class="txn-amount ${tx.direction}">${tx.direction === 'inflow' ? '+' : '-'}${formatJMD(tx.amount)}</span>
          ${
            showActions
              ? `<div class="txn-actions">
            <button class="btn btn-sm btn-ghost" onclick="deleteTxn('${tx.id}')">🗑</button>
          </div>`
              : ''
          }
        </div>
      </div>
    `
      )
      .join('');
  }

  window.deleteTxn = async function (id) {
    if (!confirm('Delete this transaction?')) return;

    try {
      const data = await api(CONFIG.ENDPOINTS.editTransaction, {
        method: 'POST',
        body: JSON.stringify({
          transaction_id: id,
          action: 'delete',
        }),
      });

      if (data.success) {
        showToast('Transaction deleted', 'success');
        loadTransactions();
        loadDashboard();
      } else {
        showToast(data.error || 'Delete failed', 'error');
      }
    } catch (err) {
      showToast('Delete failed', 'error');
    }
  };

  // ============================================================
  // ACCOUNTS
  // ============================================================
  async function loadAccounts() {
    try {
      const data = await api(CONFIG.ENDPOINTS.accounts);
      if (data.success && data.accounts) {
        renderAccountsList(
          data.accounts,
          document.getElementById('accounts-detail')
        );
      }
    } catch (err) {
      console.error('Accounts load error:', err);
    }
  }

  function renderAccountsList(accounts, container) {
    if (!accounts || accounts.length === 0) {
      container.innerHTML =
        '<p class="empty-state">No accounts yet. Tell me: "I have 30k in NCB and 5k cash"</p>';
      return;
    }

    container.innerHTML = accounts
      .map(
        (acc) => `
      <div class="account-card">
        <span class="acc-type">${acc.account_type}</span>
        <span class="acc-name">${escapeHtml(acc.name)}</span>
        <span class="acc-balance">${formatJMD(acc.balance)}</span>
      </div>
    `
      )
      .join('');
  }

  // ============================================================
  // SUBSCRIPTION
  // ============================================================
  async function loadSubscription() {
    try {
      const data = await api(CONFIG.ENDPOINTS.subscription);
      if (data.success && data.subscription) {
        const sub = data.subscription;
        const plan = sub.plan_name || 'free';
        const isPro = plan !== 'free' && sub.status === 'active';

        // Update badge
        const badge = document.getElementById('user-plan');
        badge.textContent = isPro ? 'PRO' : 'Free';
        badge.className = 'plan-badge' + (isPro ? ' pro' : '');

        // Plan info
        document.getElementById('current-plan').innerHTML = `
          <div style="display:flex;align-items:center;gap:12px;">
            <span style="font-size:2rem">${isPro ? '⭐' : '🆓'}</span>
            <div>
              <strong style="font-size:1.1rem">${isPro ? 'Pro Plan' : 'Free Plan'}</strong>
              <p style="color:var(--text-secondary);font-size:0.85rem">
                Status: ${sub.status || 'active'}
                ${sub.current_period_end ? ' · Renews: ' + formatDate(sub.current_period_end) : ''}
              </p>
            </div>
          </div>
        `;

        // Usage
        const txCount = parseInt(sub.tx_count) || 0;
        const ocrCount = parseInt(sub.ocr_count) || 0;
        const txLimit = isPro ? '∞' : '100';
        const ocrLimit = isPro ? '∞' : '3';
        const txPct = isPro ? 10 : Math.min((txCount / 100) * 100, 100);
        const ocrPct = isPro ? 10 : Math.min((ocrCount / 3) * 100, 100);

        document.getElementById('usage-details').innerHTML = `
          <div class="usage-item">
            <span class="usage-label">Transactions</span>
            <span class="usage-value">${txCount} / ${txLimit}</span>
            <div class="usage-bar"><div class="usage-bar-fill ${txPct > 80 ? 'danger' : txPct > 50 ? 'warning' : ''}" style="width:${txPct}%"></div></div>
          </div>
          <div class="usage-item">
            <span class="usage-label">OCR Uploads</span>
            <span class="usage-value">${ocrCount} / ${ocrLimit}</span>
            <div class="usage-bar"><div class="usage-bar-fill ${ocrPct > 80 ? 'danger' : ocrPct > 50 ? 'warning' : ''}" style="width:${ocrPct}%"></div></div>
          </div>
        `;
      }
    } catch (err) {
      console.error('Subscription load error:', err);
    }
  }

  window.subscribePro = function (interval) {
    // Redirect to PayPal subscription page
    // In production, create the subscription via PayPal API and get approval URL
    const planId =
      interval === 'yearly'
        ? CONFIG.PAYPAL_YEARLY_PLAN_ID
        : CONFIG.PAYPAL_MONTHLY_PLAN_ID;

    // PayPal Subscription URL format (sandbox example)
    const paypalUrl = `https://www.paypal.com/webapps/billing/plans/subscribe?plan_id=${planId}&custom_id=${state.user?.id || ''}`;

    showToast(
      'Redirecting to PayPal... (Configure PayPal Plan IDs in app.js)',
      'success'
    );

    // In production, open this URL:
    // window.open(paypalUrl, '_blank');

    console.log('PayPal Subscription URL:', paypalUrl);
    console.log('Plan ID:', planId);
    console.log('User ID (custom_id):', state.user?.id);
  };

  // ============================================================
  // UTILITIES
  // ============================================================
  function formatJMD(amount) {
    return (
      'J$' +
      Number(amount || 0).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    );
  }

  function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function setLoading(btn, loading) {
    const text = btn.querySelector('.btn-text');
    const loader = btn.querySelector('.btn-loader');
    if (text) text.classList.toggle('hidden', loading);
    if (loader) loader.classList.toggle('hidden', !loading);
    btn.disabled = loading;
  }

  function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast ${type}`;
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 4000);
  }
})();
