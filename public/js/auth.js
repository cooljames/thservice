/* ============================================================
   thservice: 사용자 인증 & 카카오 로그인 모듈 (stockdash 참조)
   ============================================================ */

window.ThAuth = (function () {
  'use strict';

  let currentUser = null;
  let cachedMembers = [];
  const callbacks = [];

  // API 호출 헬퍼
  async function apiRequest(url, options = {}) {
    options.headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };
    options.credentials = 'include';
    const res = await fetch(url, options);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || '요청 처리 중 오류가 발생했습니다.');
    }
    return data;
  }

  // 원무부 등록 회원 명단 로드 (실명 가입용)
  async function loadRegisteredMembers() {
    try {
      const res = await fetch('/api/members');
      const data = await res.json();
      if (data.success) {
        cachedMembers = data.members || [];
        populateMembersDatalist();
      }
    } catch (e) {
      console.error('Failed to load registered members:', e);
    }
  }

  function populateMembersDatalist() {
    const datalist = document.getElementById('registered-members-datalist');
    if (!datalist) return;
    datalist.innerHTML = '';
    cachedMembers.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.name;
      opt.label = `${m.team} ${m.isLeader ? '(조장)' : ''}`;
      datalist.appendChild(opt);
    });
  }

  // 실명 입력 시 소속 조 자동 감지
  function handleNameInputChange(nameValue) {
    const matched = cachedMembers.find(m => m.name === nameValue.trim());
    const teamNotice = document.getElementById('reg-team-auto-notice');
    const teamBadge = document.getElementById('reg-detected-team');

    if (matched) {
      if (teamNotice) teamNotice.style.display = 'block';
      if (teamBadge) {
        teamBadge.innerText = `${matched.team} ${matched.isLeader ? '(조장)' : ''}`;
        teamBadge.className = `badge-tag ${matched.team === '1조' ? 'badge-team1' : 'badge-team2'}`;
      }
    } else {
      if (teamNotice) teamNotice.style.display = 'none';
    }
  }

  // 로그인 상태 확인
  async function checkAuth() {
    try {
      const data = await apiRequest('/api/me', { method: 'GET' });
      currentUser = data.authenticated ? data.user : null;
    } catch (e) {
      currentUser = null;
    }
    notifySubscribers();
    return currentUser;
  }

  // 이메일 로그인
  async function login(email, password) {
    const data = await apiRequest('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
    currentUser = data.user;
    notifySubscribers();
    return data;
  }

  // 실명 회원가입
  async function register(userData) {
    const data = await apiRequest('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(userData)
    });
    currentUser = data.user;
    notifySubscribers();
    return data;
  }

  // 로그아웃
  async function logout() {
    await apiRequest('/api/auth/logout', { method: 'POST' });
    currentUser = null;
    notifySubscribers();
  }

  // 카카오 로그인 팝업 열기
  function openKakaoLogin() {
    const width = 480;
    const height = 640;
    const left = window.screenX + (window.outerWidth - width) / 2;
    const top = window.screenY + (window.outerHeight - height) / 2;
    const popup = window.open(
      '/api/auth/kakao',
      'kakao_login_popup',
      `width=${width},height=${height},top=${top},left=${left},scrollbars=yes`
    );
    if (!popup) {
      alert('팝업 차단이 설정되어 있습니다. 팝업을 허용해주세요.');
    }
  }

  // 팝업으로부터의 메시지 수신 (로그인 완료 이벤트)
  window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'KAKAO_LOGIN_SUCCESS') {
      currentUser = event.data.user;
      notifySubscribers();
      if (window.ThApp && window.ThApp.showToast) {
        window.ThApp.showToast(`카카오톡 로그인 성공! (${currentUser.name}님)`, 'success');
      }
      closeAuthModal();
      if (window.ThCalendar) window.ThCalendar.refresh();
      if (window.ThDashboard) window.ThDashboard.loadStats();
    }
  });

  // 상태 변경 구독
  function subscribe(fn) {
    callbacks.push(fn);
    fn(currentUser);
  }

  function notifySubscribers() {
    callbacks.forEach(fn => {
      try { fn(currentUser); } catch (e) { console.error(e); }
    });
  }

  // 모달 제어
  function openAuthModal(mode = 'login') {
    const modal = document.getElementById('auth-modal');
    if (!modal) return;
    setAuthModalMode(mode);
    modal.classList.add('active');
    loadRegisteredMembers();
  }

  function closeAuthModal() {
    const modal = document.getElementById('auth-modal');
    if (modal) modal.classList.remove('active');
  }

  function setAuthModalMode(mode) {
    const loginBox = document.getElementById('modal-login-form');
    const registerBox = document.getElementById('modal-register-form');
    const title = document.getElementById('auth-modal-title');
    if (mode === 'login') {
      if (loginBox) loginBox.style.display = 'block';
      if (registerBox) registerBox.style.display = 'none';
      if (title) title.innerText = '원무부 봉사 로그인';
    } else {
      if (loginBox) loginBox.style.display = 'none';
      if (registerBox) registerBox.style.display = 'block';
      if (title) title.innerText = '원무부 실명 회원가입';
    }
  }

  return {
    checkAuth,
    login,
    register,
    logout,
    openKakaoLogin,
    getUser: () => currentUser,
    isRoot: () => currentUser && currentUser.role === 'root',
    isAdmin: () => currentUser && (currentUser.role === 'admin' || currentUser.role === 'root'),
    subscribe,
    openAuthModal,
    closeAuthModal,
    setAuthModalMode,
    loadRegisteredMembers,
    handleNameInputChange,
    getRegisteredMembers: () => cachedMembers
  };
})();
