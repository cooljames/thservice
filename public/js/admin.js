/* ============================================================
   thservice: 관리자 및 원무부 회원/봉사자 DB 관리 모듈
   ============================================================ */

window.ThAdmin = (function () {
  'use strict';

  let userList = [];
  let memberList = [];

  // 전체 가입 회원 및 원무부 명단 로드
  async function loadUsers() {
    const rootGuard = document.getElementById('admin-root-guard-banner');
    const rootContent = document.getElementById('admin-root-content');
    const user = window.ThAuth ? window.ThAuth.getUser() : null;

    if (!user || (user.role !== 'root' && user.role !== 'admin')) {
      if (rootGuard) rootGuard.style.display = 'block';
      if (rootContent) rootContent.style.display = 'none';
      return;
    }

    if (rootGuard) rootGuard.style.display = 'none';
    if (rootContent) rootContent.style.display = 'block';

    // 1. 가입 계정 목록 로드
    try {
      const data = await window.ThAuth.apiRequest('/api/admin/users', { method: 'GET' });
      if (!data.success) throw new Error(data.error);

      userList = data.users || [];
      renderUserTable(userList);
      updateUserCountSummary(userList);
    } catch (err) {
      console.error('Failed to load admin users:', err);
      const tbody = document.getElementById('admin-users-tbody');
      if (tbody) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#EF4444;padding:2rem;">가입 계정 목록 조회 실패: ${err.message}</td></tr>`;
      }
    }

    // 2. 원무부 봉사자 DB 명단 로드
    await loadMembers();
  }

  // 원무부 봉사자 DB 명단 로드
  async function loadMembers() {
    try {
      const data = await window.ThAuth.apiRequest('/api/members', { method: 'GET' });
      if (data.success) {
        memberList = data.members || [];
        renderMembersTable(memberList);
        updateMemberCountSummary(memberList);
      }
    } catch (err) {
      console.error('Failed to load registered members:', err);
      const tbody = document.getElementById('admin-members-tbody');
      if (tbody) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#EF4444;padding:2rem;">봉사자 명단 조회 실패: ${err.message}</td></tr>`;
      }
    }
  }

  // 사용자 수 요약 카운트 갱신
  function updateUserCountSummary(users) {
    const totalEl = document.getElementById('summary-total-users');
    const rootEl = document.getElementById('summary-root-users');
    const adminEl = document.getElementById('summary-admin-users');
    const countUsersTab = document.getElementById('count-subtab-users');

    if (totalEl) totalEl.innerText = `${users.length}명`;
    if (rootEl) rootEl.innerText = `${users.filter(u => u.role === 'root').length}명`;
    if (adminEl) adminEl.innerText = `${users.filter(u => u.role === 'admin').length}명`;
    if (countUsersTab) countUsersTab.innerText = users.length;
  }

  // 봉사자 명단 요약 카운트 갱신
  function updateMemberCountSummary(members) {
    const totalMembersEl = document.getElementById('summary-total-members');
    const countMembersTab = document.getElementById('count-subtab-members');

    if (totalMembersEl) totalMembersEl.innerText = `${members.length}명`;
    if (countMembersTab) countMembersTab.innerText = members.length;
  }

  // 1. 가입 계정 테이블 렌더링
  function renderUserTable(users) {
    const tbody = document.getElementById('admin-users-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const currentLoggedUser = window.ThAuth ? window.ThAuth.getUser() : null;

    if (users.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--text-secondary);padding:2rem;">등록된 가입 계정이 없습니다.</td></tr>`;
      return;
    }

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
          <strong>${u.name || u.memberName || '-'}</strong>
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

  // 2. 원무부 봉사자 명단 DB 테이블 렌더링
  function renderMembersTable(members) {
    const tbody = document.getElementById('admin-members-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (members.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--text-secondary);padding:2rem;">등록된 원무부 봉사자가 없습니다. 신규 봉사자를 등록해주세요.</td></tr>`;
      return;
    }

    members.forEach((m, idx) => {
      const tr = document.createElement('tr');
      const teamBadge = m.team === '1조' ? 'badge-team1' : (m.team === '2조' ? 'badge-team2' : 'badge-user');
      const leaderBadge = m.isLeader 
        ? '<span class="badge-tag" style="background:#FEF3C7;color:#D97706;font-weight:700;">⭐ 조장</span>' 
        : '<span style="color:#64748B;font-size:0.85rem;">봉사팀원</span>';

      tr.innerHTML = `
        <td style="color:var(--text-secondary);font-size:0.85rem;">${idx + 1}</td>
        <td><strong>${m.name}</strong></td>
        <td><span class="badge-tag ${teamBadge}">${m.team || '미지정'}</span></td>
        <td>${leaderBadge}</td>
        <td><span style="font-family:monospace;font-size:0.85rem;color:var(--text-secondary);">${m.phone || '-'}</span></td>
        <td style="font-size:0.85rem;color:var(--text-secondary);">${m.note || '-'}</td>
        <td>
          <button class="btn-user-delete btn-member-delete" data-member-id="${m.id}" data-member-name="${m.name}">삭제</button>
        </td>
      `;

      tbody.appendChild(tr);
    });

    // 봉사자 명단 삭제 이벤트 바인딩
    tbody.querySelectorAll('.btn-member-delete').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const memberId = e.target.dataset.memberId;
        const memberName = e.target.dataset.memberName;
        if (confirm(`정말 "${memberName}" 봉사자를 원무부 명단 DB에서 삭제하시겠습니까?\n※ 삭제 시 회원가입 및 조편성 명단에서도 제외됩니다.`)) {
          await deleteMember(memberId);
        }
      });
    });
  }

  // 봉사자 명단 삭제 API
  async function deleteMember(memberId) {
    try {
      const res = await window.ThAuth.apiRequest(`/api/members/${memberId}`, {
        method: 'DELETE'
      });
      if (window.ThApp) window.ThApp.showToast(res.message, 'info');
      await loadMembers();
      if (window.ThAuth && window.ThAuth.loadRegisteredMembers) {
        window.ThAuth.loadRegisteredMembers();
      }
    } catch (err) {
      if (window.ThApp) window.ThApp.showToast(err.message, 'error');
    }
  }

  // 역할 변경 API 호출
  async function changeRole(userId, newRole) {
    try {
      const data = await window.ThAuth.apiRequest(`/api/admin/users/${userId}/role`, {
        method: 'PUT',
        body: JSON.stringify({ role: newRole })
      });

      if (window.ThApp) window.ThApp.showToast(data.message, 'success');
      await loadUsers();
    } catch (err) {
      if (window.ThApp) window.ThApp.showToast(err.message, 'error');
      await loadUsers();
    }
  }

  // 사용자 계정 삭제 API 호출
  async function deleteUser(userId) {
    try {
      const data = await window.ThAuth.apiRequest(`/api/admin/users/${userId}`, {
        method: 'DELETE'
      });

      if (window.ThApp) window.ThApp.showToast(data.message, 'info');
      await loadUsers();
    } catch (err) {
      if (window.ThApp) window.ThApp.showToast(err.message, 'error');
    }
  }

  // 서브탭 전환 설정
  function setupSubtabs() {
    const btnUsers = document.getElementById('btn-subtab-users');
    const btnMembers = document.getElementById('btn-subtab-members');
    const panelUsers = document.getElementById('subtab-panel-users');
    const panelMembers = document.getElementById('subtab-panel-members');

    if (!btnUsers || !btnMembers || !panelUsers || !panelMembers) return;

    btnUsers.addEventListener('click', () => {
      btnUsers.style.color = 'var(--primary)';
      btnUsers.style.borderBottom = '2px solid var(--primary)';
      btnUsers.style.fontWeight = '700';

      btnMembers.style.color = 'var(--text-secondary)';
      btnMembers.style.borderBottom = 'none';
      btnMembers.style.fontWeight = '600';

      panelUsers.style.display = 'block';
      panelMembers.style.display = 'none';
    });

    btnMembers.addEventListener('click', () => {
      btnMembers.style.color = 'var(--primary)';
      btnMembers.style.borderBottom = '2px solid var(--primary)';
      btnMembers.style.fontWeight = '700';

      btnUsers.style.color = 'var(--text-secondary)';
      btnUsers.style.borderBottom = 'none';
      btnUsers.style.fontWeight = '600';

      panelMembers.style.display = 'block';
      panelUsers.style.display = 'none';
    });
  }

  // 신규 봉사자 DB 등록 모달 설정
  function setupMemberCreateModal() {
    const modal = document.getElementById('modal-member-create');
    const btnOpen = document.getElementById('btn-open-member-create');
    const btnClose = document.getElementById('btn-close-member-create');
    const form = document.getElementById('form-member-create');
    const checkCreateUser = document.getElementById('member-input-create-user');
    const userFieldsBox = document.getElementById('member-create-user-fields');

    if (btnOpen && modal) {
      btnOpen.addEventListener('click', () => {
        if (form) form.reset();
        if (userFieldsBox) userFieldsBox.style.display = 'none';
        modal.classList.add('active');
      });
    }

    if (btnClose && modal) {
      btnClose.addEventListener('click', () => {
        modal.classList.remove('active');
      });
    }

    if (checkCreateUser && userFieldsBox) {
      checkCreateUser.addEventListener('change', (e) => {
        userFieldsBox.style.display = e.target.checked ? 'block' : 'none';
      });
    }

    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('member-input-name').value.trim();
        const team = document.getElementById('member-input-team').value;
        const isLeader = document.getElementById('member-input-leader').checked;
        const phone = document.getElementById('member-input-phone').value.trim();
        const note = document.getElementById('member-input-note').value.trim();

        const createUser = checkCreateUser ? checkCreateUser.checked : false;
        let email = '';
        let password = '';
        let role = 'user';

        if (createUser) {
          email = document.getElementById('member-input-email').value.trim();
          password = document.getElementById('member-input-password').value.trim();
          role = document.getElementById('member-input-role').value;

          if (!email) {
            if (window.ThApp) window.ThApp.showToast('로그인 이메일을 입력해주세요.', 'error');
            return;
          }
        }

        try {
          const res = await window.ThAuth.apiRequest('/api/members', {
            method: 'POST',
            body: JSON.stringify({
              name,
              team,
              isLeader,
              phone,
              note,
              createUser,
              email,
              password,
              role
            })
          });

          if (window.ThApp) window.ThApp.showToast(res.message, 'success');
          if (modal) modal.classList.remove('active');
          form.reset();

          // 목록 갱신
          await loadMembers();
          if (createUser) {
            await loadUsers();
          }
          if (window.ThAuth && window.ThAuth.loadRegisteredMembers) {
            window.ThAuth.loadRegisteredMembers();
          }
        } catch (err) {
          if (window.ThApp) window.ThApp.showToast(err.message, 'error');
        }
      });
    }
  }

  function init() {
    const openLoginBtn = document.getElementById('btn-admin-pane-open-login');
    if (openLoginBtn) {
      openLoginBtn.addEventListener('click', () => {
        if (window.ThAuth) window.ThAuth.openAuthModal('login');
      });
    }

    setupSubtabs();
    setupMemberCreateModal();
  }

  document.addEventListener('DOMContentLoaded', init);

  return {
    loadUsers,
    loadMembers,
    init
  };
})();
