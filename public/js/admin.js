/* ============================================================
   thservice: Root 전용 회원 관리 모듈 (root > admin > user)
   ============================================================ */

window.ThAdmin = (function () {
  'use strict';

  let userList = [];

  // 전체 가입 회원 목록 로드
  async function loadUsers() {
    const rootGuard = document.getElementById('admin-root-guard-banner');
    const rootContent = document.getElementById('admin-root-content');
    const tbody = document.getElementById('admin-users-tbody');
    const user = window.ThAuth ? window.ThAuth.getUser() : null;

    if (!user || user.role !== 'root') {
      if (rootGuard) rootGuard.style.display = 'block';
      if (rootContent) rootContent.style.display = 'none';
      return;
    }

    if (rootGuard) rootGuard.style.display = 'none';
    if (rootContent) rootContent.style.display = 'block';
    if (!tbody) return;

    try {
      const res = await fetch('/api/admin/users');
      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      userList = data.users;
      renderUserTable(userList);
      updateUserCountSummary(userList);
    } catch (err) {
      console.error('Failed to load admin users:', err);
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#EF4444;padding:2rem;">회원 목록 조회 실패: ${err.message}</td></tr>`;
    }
  }

  // 사용자 수 요약 카운트 갱신
  function updateUserCountSummary(users) {
    const totalEl = document.getElementById('summary-total-users');
    const rootEl = document.getElementById('summary-root-users');
    const adminEl = document.getElementById('summary-admin-users');
    const userEl = document.getElementById('summary-normal-users');

    if (totalEl) totalEl.innerText = `${users.length}명`;
    if (rootEl) rootEl.innerText = `${users.filter(u => u.role === 'root').length}명`;
    if (adminEl) adminEl.innerText = `${users.filter(u => u.role === 'admin').length}명`;
    if (userEl) userEl.innerText = `${users.filter(u => u.role === 'user').length}명`;
  }

  // 테이블 렌더링
  function renderUserTable(users) {
    const tbody = document.getElementById('admin-users-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const currentLoggedUser = window.ThAuth ? window.ThAuth.getUser() : null;

    users.forEach((u) => {
      const tr = document.createElement('tr');
      const isSelf = currentLoggedUser && currentLoggedUser.id === u.id;

      let badgeClass = 'badge-user';
      let badgeText = '일반회원';
      if (u.role === 'root') { badgeClass = 'badge-root'; badgeText = '최고관리자 (Root)'; }
      else if (u.role === 'admin') { badgeClass = 'badge-admin'; badgeText = '원무관리자 (Admin)'; }

      const teamBadge = u.team === '1조' ? 'badge-team1' : (u.team === '2조' ? 'badge-team2' : 'badge-user');

      tr.innerHTML = `
        <td>
          <strong>${u.name || u.memberName}</strong>
          ${isSelf ? '<span class="badge-tag" style="background:#3B82F6;color:#fff;margin-left:4px;">나</span>' : ''}
        </td>
        <td><span style="font-family:monospace;font-size:0.85rem;color:var(--text-secondary);">${u.email}</span></td>
        <td><span class="badge-tag ${teamBadge}">${u.team || '미지정'}</span></td>
        <td><span class="badge-tag ${badgeClass}">${badgeText}</span></td>
        <td>
          <select class="admin-role-select" data-user-id="${u.id}" ${isSelf ? 'title="본인 권한은 다른 관리자가 변경해야 합니다"' : ''}>
            <option value="user" ${u.role === 'user' ? 'selected' : ''}>일반회원 (User)</option>
            <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>원무관리자 (Admin)</option>
            <option value="root" ${u.role === 'root' ? 'selected' : ''}>최고관리자 (Root)</option>
          </select>
        </td>
        <td>
          ${!isSelf ? `<button class="btn-user-delete" data-user-id="${u.id}" data-user-name="${u.name || u.memberName}">삭제</button>` : '<span style="color:#94A3B8;font-size:0.8rem;">-</span>'}
        </td>
      `;

      tbody.appendChild(tr);
    });

    // 역할 변경 이벤트 바인딩
    tbody.querySelectorAll('.admin-role-select').forEach(select => {
      select.addEventListener('change', async (e) => {
        const userId = e.target.dataset.userId;
        const newRole = e.target.value;
        await changeRole(userId, newRole);
      });
    });

    // 삭제 버튼 이벤트 바인딩
    tbody.querySelectorAll('.btn-user-delete').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const userId = e.target.dataset.userId;
        const userName = e.target.dataset.userName;
        if (confirm(`정말 "${userName}" 사용자를 시스템에서 삭제하시겠습니까?`)) {
          await deleteUser(userId);
        }
      });
    });
  }

  // 역할 변경 API 호출
  async function changeRole(userId, newRole) {
    try {
      const res = await fetch(`/api/admin/users/${userId}/role`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      if (window.ThApp) window.ThApp.showToast(data.message, 'success');
      await loadUsers();
    } catch (err) {
      if (window.ThApp) window.ThApp.showToast(err.message, 'error');
      await loadUsers(); // 복원
    }
  }

  // 사용자 삭제 API 호출
  async function deleteUser(userId) {
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'DELETE'
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      if (window.ThApp) window.ThApp.showToast(data.message, 'info');
      await loadUsers();
    } catch (err) {
      if (window.ThApp) window.ThApp.showToast(err.message, 'error');
    }
  }

  function init() {
    const quickLoginBtn = document.getElementById('btn-admin-pane-quick-login');
    const openLoginBtn = document.getElementById('btn-admin-pane-open-login');

    if (quickLoginBtn) {
      quickLoginBtn.addEventListener('click', async () => {
        try {
          await window.ThAuth.login('admin@example.com', '1234');
          if (window.ThApp) window.ThApp.showToast('최고 관리자(Root)로 즉시 로그인되었습니다.', 'success');
          loadUsers();
        } catch (e) {
          if (window.ThApp) window.ThApp.showToast(e.message, 'error');
        }
      });
    }

    if (openLoginBtn) {
      openLoginBtn.addEventListener('click', () => {
        if (window.ThAuth) window.ThAuth.openAuthModal('login');
      });
    }
  }

  document.addEventListener('DOMContentLoaded', init);

  return {
    loadUsers,
    init
  };
})();
