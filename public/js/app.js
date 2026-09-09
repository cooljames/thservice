/* ============================================================
   thservice: 전역 앱 초기화 & 탭 라우팅 컨트롤러
   ============================================================ */

window.ThApp = (function () {
  'use strict';

  // 토스트 메시지
  function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    let icon = 'ℹ️';
    if (type === 'success') icon = '✅';
    if (type === 'error') icon = '⚠️';

    toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  // 탭 네비게이션 전환
  function switchTab(tabId) {
    document.querySelectorAll('.nav-tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabId);
    });

    document.querySelectorAll('.tab-pane').forEach(pane => {
      pane.classList.toggle('active', pane.id === `pane-${tabId}`);
    });

    if (tabId === 'dashboard' && window.ThDashboard) {
      window.ThDashboard.loadStats();
    }
    if (tabId === 'calendar' && window.ThCalendar) {
      window.ThCalendar.refresh();
    }
    if (tabId === 'admin-users' && window.ThAdmin) {
      window.ThAdmin.loadUsers();
    }
  }

  // 인증 상태 UI 갱신 (3단계 권한 root > admin > user)
  function renderAuthUi(user) {
    const guestSection = document.getElementById('header-guest-section');
    const userSection = document.getElementById('header-user-section');
    const userNameEl = document.getElementById('header-user-name');
    const userRoleEl = document.getElementById('header-user-role');
    const userAvatarEl = document.getElementById('header-user-avatar');

    // Root 회원 관리 탭 버튼: 상시 선명하게 표시
    const adminUsersTabBtn = document.getElementById('tab-btn-admin-users');
    if (adminUsersTabBtn) {
      adminUsersTabBtn.innerHTML = '<span>🛠️</span> 회원 관리';
      adminUsersTabBtn.style.opacity = '1';
    }

    // 헤더 프로필 영역 회원관리 단축 버튼 (Root 계정일 때 노출)
    const headerUserMgmtBtn = document.getElementById('btn-header-user-mgmt');
    if (headerUserMgmtBtn) {
      headerUserMgmtBtn.style.display = (user && user.role === 'root') ? 'inline-block' : 'none';
    }

    // Admin/Root 봉사 일정 등록 버튼 제어
    const createEventBtn = document.getElementById('btn-open-event-create');
    if (createEventBtn) {
      createEventBtn.style.display = (user && user.isAdmin) ? 'inline-flex' : 'none';
    }

    if (user) {
      if (guestSection) guestSection.style.display = 'none';
      if (userSection) userSection.style.display = 'flex';

      if (userNameEl) userNameEl.innerText = user.name || user.memberName;
      if (userRoleEl) {
        if (user.role === 'root') {
          userRoleEl.innerText = '최고관리자 (Root)';
          userRoleEl.className = 'badge-tag badge-root';
        } else if (user.role === 'admin') {
          userRoleEl.innerText = '원무관리자 (Admin)';
          userRoleEl.className = 'badge-tag badge-admin';
        } else {
          userRoleEl.innerText = `${user.team || '회원'}`;
          userRoleEl.className = 'badge-tag badge-user';
        }
      }
      if (userAvatarEl) {
        if (user.picture) {
          userAvatarEl.innerHTML = `<img src="${user.picture}" alt="프로필">`;
        } else {
          userAvatarEl.innerText = (user.name || 'U').charAt(0);
        }
      }
    } else {
      if (guestSection) guestSection.style.display = 'block';
      if (userSection) userSection.style.display = 'none';
    }

    if (window.ThCalendar) window.ThCalendar.updateAdminVisibility();
  }

  // 폼 이벤트 바인딩
  function bindAuthForms() {
    const loginTrigger = document.getElementById('btn-open-login');
    if (loginTrigger) {
      loginTrigger.addEventListener('click', () => window.ThAuth.openAuthModal('login'));
    }

    const modalClose = document.getElementById('btn-close-auth-modal');
    const modalOverlay = document.getElementById('auth-modal');
    if (modalClose) modalClose.addEventListener('click', () => window.ThAuth.closeAuthModal());
    if (modalOverlay) {
      modalOverlay.addEventListener('click', (e) => {
        if (e.target === modalOverlay) window.ThAuth.closeAuthModal();
      });
    }

    const toRegister = document.getElementById('link-to-register');
    const toLogin = document.getElementById('link-to-login');
    if (toRegister) {
      toRegister.addEventListener('click', (e) => {
        e.preventDefault();
        window.ThAuth.setAuthModalMode('register');
      });
    }
    if (toLogin) {
      toLogin.addEventListener('click', (e) => {
        e.preventDefault();
        window.ThAuth.setAuthModalMode('login');
      });
    }

    // 실명 입력 시 소속 조 자동 감지 이벤트
    const regNameInput = document.getElementById('reg-name');
    if (regNameInput) {
      ['input', 'change'].forEach(evt => {
        regNameInput.addEventListener(evt, (e) => {
          window.ThAuth.handleNameInputChange(e.target.value);
        });
      });
    }

    // 퀵 테스트 로그인 버튼 (클릭 시 자동 입력 및 로그인)
    const quickRootBtn = document.getElementById('btn-quick-login-root');
    const quickUserBtn = document.getElementById('btn-quick-login-user');
    if (quickRootBtn) {
      quickRootBtn.addEventListener('click', async () => {
        document.getElementById('login-email').value = 'root@example.com';
        document.getElementById('login-password').value = '1234';
        try {
          const res = await window.ThAuth.login('root@example.com', '1234');
          showToast(`최고 관리자 (Root) 계정으로 로그인되었습니다.`, 'success');
          window.ThAuth.closeAuthModal();
          if (window.ThCalendar) window.ThCalendar.refresh();
          if (window.ThDashboard) window.ThDashboard.loadStats();
          switchTab('admin-users');
        } catch (e) {
          showToast(e.message, 'error');
        }
      });
    }
    if (quickUserBtn) {
      quickUserBtn.addEventListener('click', async () => {
        document.getElementById('login-email').value = 'volunteer@example.com';
        document.getElementById('login-password').value = '1234';
        try {
          const res = await window.ThAuth.login('volunteer@example.com', '1234');
          showToast(`일반 봉사자 회원으로 로그인되었습니다.`, 'success');
          window.ThAuth.closeAuthModal();
          if (window.ThCalendar) window.ThCalendar.refresh();
          if (window.ThDashboard) window.ThDashboard.loadStats();
          switchTab('calendar');
        } catch (e) {
          showToast(e.message, 'error');
        }
      });
    }

    // 카카오 로그인 버튼
    document.querySelectorAll('.btn-kakao-login').forEach(btn => {
      btn.addEventListener('click', () => window.ThAuth.openKakaoLogin());
    });

    // 이메일 로그인 폼 제출
    const loginForm = document.getElementById('form-email-login');
    if (loginForm) {
      loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;
        try {
          const res = await window.ThAuth.login(email, password);
          showToast(res.message, 'success');
          window.ThAuth.closeAuthModal();
          if (window.ThCalendar) window.ThCalendar.refresh();
          if (window.ThDashboard) window.ThDashboard.loadStats();
          if (res.user && res.user.role === 'root' && window.ThAdmin) {
            window.ThAdmin.loadUsers();
          }
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    }

    // 실명 회원가입 폼 제출
    const registerForm = document.getElementById('form-register');
    if (registerForm) {
      registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('reg-name').value;
        const email = document.getElementById('reg-email').value;
        const password = document.getElementById('reg-password').value;
        try {
          const res = await window.ThAuth.register({ name, email, password });
          showToast(res.message, 'success');
          window.ThAuth.closeAuthModal();
          if (window.ThCalendar) window.ThCalendar.refresh();
          if (window.ThDashboard) window.ThDashboard.loadStats();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    }

    // 헤더 회원관리 단축 버튼
    const headerUserMgmtBtn = document.getElementById('btn-header-user-mgmt');
    if (headerUserMgmtBtn) {
      headerUserMgmtBtn.addEventListener('click', () => switchTab('admin-users'));
    }

    // 로그아웃 버튼
    const logoutBtn = document.getElementById('btn-header-logout');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async () => {
        await window.ThAuth.logout();
        showToast('안전하게 로그아웃되었습니다.', 'info');
        switchTab('calendar');
        if (window.ThCalendar) window.ThCalendar.refresh();
        if (window.ThDashboard) window.ThDashboard.loadStats();
      });
    }
  }

  async function init() {
    document.querySelectorAll('.nav-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    bindAuthForms();
    window.ThAuth.subscribe(renderAuthUi);

    await window.ThAuth.checkAuth();
    if (window.ThCalendar) await window.ThCalendar.init();
    if (window.ThDashboard) await window.ThDashboard.init();
  }

  document.addEventListener('DOMContentLoaded', init);

  return {
    showToast,
    switchTab
  };
})();
