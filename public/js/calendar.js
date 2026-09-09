/* ============================================================
   thservice: 격주 목요일 봉사 캘린더 인터랙션 & Admin 일정 관리 모듈
   ============================================================ */

window.ThCalendar = (function () {
  'use strict';

  let currentYear = 2026;
  let currentMonth = 9; // 기본 9월 (사용자 첨부 이미지 기준)
  let eventsData = [];
  let currentSelectedEvent = null;

  // 주요 기념일 및 공휴일 데이터
  const holidays = {
    '2026-01-01': { name: '신정', isRed: true },
    '2026-02-16': { name: '설날 연휴', isRed: true },
    '2026-02-17': { name: '설날', isRed: true },
    '2026-02-18': { name: '설날 연휴', isRed: true },
    '2026-03-01': { name: '3·1절', isRed: true },
    '2026-05-05': { name: '어린이날', isRed: true },
    '2026-05-24': { name: '부처님오신날', isRed: true },
    '2026-06-06': { name: '현충일', isRed: true },
    '2026-08-15': { name: '광복절', isRed: true },
    '2026-09-24': { name: '추석 연휴', isRed: true },
    '2026-09-25': { name: '추석', isRed: true },
    '2026-09-26': { name: '추석 연휴', isRed: true },
    '2026-10-03': { name: '개천절', isRed: true },
    '2026-10-09': { name: '한글날', isRed: true },
    '2026-12-25': { name: '성탄절', isRed: true }
  };

  // 인증 포함 API 호출 래퍼 (쿠키 + Bearer 토큰 자동 전송)
  async function api(url, options = {}) {
    if (window.ThAuth && window.ThAuth.apiRequest) {
      return await window.ThAuth.apiRequest(url, options);
    }
    options.credentials = 'include';
    options.headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };
    try {
      const token = localStorage.getItem('thservice_auth_token');
      if (token) options.headers['Authorization'] = `Bearer ${token}`;
    } catch (e) {}
    const res = await fetch(url, options);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || '요청 처리 중 오류가 발생했습니다.');
    }
    return data;
  }

  // 초기화
  async function init() {
    bindEvents();
    bindAdminEventCreation();
    await loadEvents();
    render();
    updateAdminVisibility();
  }

  // 이벤트 목록 서버에서 가져오기
  async function loadEvents() {
    try {
      const data = await api('/api/events');
      if (data.success) {
        eventsData = data.events;
      }
    } catch (e) {
      console.error('Failed to load events:', e);
    }
  }

  function bindEvents() {
    const prevBtn = document.getElementById('btn-cal-prev');
    const nextBtn = document.getElementById('btn-cal-next');
    const todayBtn = document.getElementById('btn-cal-today');

    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        currentMonth--;
        if (currentMonth < 1) {
          currentMonth = 12;
          currentYear--;
        }
        render();
      });
    }

    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        currentMonth++;
        if (currentMonth > 12) {
          currentMonth = 1;
          currentYear++;
        }
        render();
      });
    }

    if (todayBtn) {
      todayBtn.addEventListener('click', () => {
        currentYear = 2026;
        currentMonth = 9;
        render();
      });
    }

    // 드로어 닫기
    const closeDrawerBtn = document.getElementById('btn-close-drawer');
    const drawerOverlay = document.getElementById('drawer-overlay');
    if (closeDrawerBtn) closeDrawerBtn.addEventListener('click', closeDrawer);
    if (drawerOverlay) drawerOverlay.addEventListener('click', closeDrawer);

    // 참가 신청 버튼
    const applyToggleBtn = document.getElementById('btn-apply-toggle');
    if (applyToggleBtn) {
      applyToggleBtn.addEventListener('click', handleApplyToggle);
    }

    // 관리자: 일정 삭제 버튼
    const deleteEventBtn = document.getElementById('btn-delete-event');
    if (deleteEventBtn) {
      deleteEventBtn.addEventListener('click', () => {
        if (currentSelectedEvent && currentSelectedEvent.event) {
          deleteEventById(currentSelectedEvent.event.id, currentSelectedEvent.event.title, currentSelectedEvent.event.date);
        }
      });
    }

    // 관리자: 드로어 내 일정 수정 버튼
    const drawerEditBtn = document.getElementById('btn-drawer-edit-event');
    if (drawerEditBtn) {
      drawerEditBtn.addEventListener('click', () => {
        if (currentSelectedEvent && currentSelectedEvent.event) {
          openEditModal(currentSelectedEvent.event);
        }
      });
    }
  }

  // 신규 일정 등록 모달 열기
  function openCreateModal(dateStr) {
    const user = window.ThAuth ? window.ThAuth.getUser() : null;
    const isAdminOrRoot = user && (user.role === 'admin' || user.role === 'root');
    if (!isAdminOrRoot) {
      if (window.ThApp) window.ThApp.showToast('🔒 봉사 일정 등록은 원무관리자(Admin) 또는 Root 권한이 필요합니다.', 'error');
      if (window.ThAuth) window.ThAuth.openAuthModal('login');
      return;
    }

    const modal = document.getElementById('modal-event-create');
    if (!modal) return;

    if (dateStr) {
      const dateInput = document.getElementById('event-input-date');
      if (dateInput) dateInput.value = dateStr;
      const parts = dateStr.split('-');
      if (parts.length === 3) {
        const titleInput = document.getElementById('event-input-title');
        if (titleInput) {
          titleInput.value = `2026 어울림센터 ${parseInt(parts[1], 10)}월 ${parseInt(parts[2], 10)}일 정기 봉사활동`;
        }
      }
    }
    modal.classList.add('active');
  }

  // 일정 수정/변경 모달 열기
  function openEditModal(event) {
    const user = window.ThAuth ? window.ThAuth.getUser() : null;
    const isAdminOrRoot = user && (user.role === 'admin' || user.role === 'root');
    if (!isAdminOrRoot) {
      if (window.ThApp) window.ThApp.showToast('🔒 봉사 일정 수정/변경/삭제는 원무관리자(Admin) 또는 Root 권한이 필요합니다.', 'error');
      if (window.ThAuth) window.ThAuth.openAuthModal('login');
      return;
    }

    closeDrawer();
    const modal = document.getElementById('modal-event-edit');
    if (!modal) return;

    document.getElementById('event-edit-id').value = event.id;
    document.getElementById('event-edit-date').value = event.date;
    document.getElementById('event-edit-title').value = event.title || '';
    document.getElementById('event-edit-location').value = event.location || '어울림센터 (051-208-4458)';
    document.getElementById('event-edit-time').value = event.time || '17:30 ~ 19:00';
    document.getElementById('event-edit-notice').value = event.notice || '17시 30분까지 근무자도 가능하면 업무인계 후 참석 바랍니다.';
    document.getElementById('event-edit-status').value = event.status || 'OPEN';
    document.getElementById('event-edit-gsheet').checked = true;

    modal.classList.add('active');
  }

  // 날짜 셀 더블 클릭 핸들러 (목요일 또는 이벤트 셀)
  function handleDayCellDoubleClick(dateStr, dayOfWeek, event) {
    if (dayOfWeek !== 4 && !event) {
      return;
    }

    const user = window.ThAuth ? window.ThAuth.getUser() : null;
    const isAdminOrRoot = user && (user.role === 'admin' || user.role === 'root');

    if (!isAdminOrRoot) {
      if (window.ThApp) {
        window.ThApp.showToast('🔒 봉사 일정 등록·수정·삭제는 원무관리자(Admin) 또는 Root 권한이 필요합니다. 관리자로 로그인해주세요.', 'error');
      }
      if (window.ThAuth) window.ThAuth.openAuthModal('login');
      return;
    }

    if (event) {
      // 기존 일정이 존재하는 경우 -> 일정 수정/변경/삭제 모달
      openEditModal(event);
    } else {
      // 일정이 없는 경우 -> 해당 일자로 신규 일정 등록 모달
      openCreateModal(dateStr);
    }
  }

  // Admin / Root 일정 등록 & 수정 모달 바인딩
  function bindAdminEventCreation() {
    // 1. 신규 등록 모달
    const openCreateBtn = document.getElementById('btn-open-event-create');
    const modalCreate = document.getElementById('modal-event-create');
    const closeCreateBtn = document.getElementById('btn-close-event-create');
    const formCreate = document.getElementById('form-create-event');

    if (openCreateBtn) {
      openCreateBtn.addEventListener('click', () => openCreateModal());
    }

    if (closeCreateBtn && modalCreate) {
      closeCreateBtn.addEventListener('click', () => modalCreate.classList.remove('active'));
    }

    if (modalCreate) {
      modalCreate.addEventListener('click', (e) => {
        if (e.target === modalCreate) modalCreate.classList.remove('active');
      });
    }

    if (formCreate) {
      formCreate.addEventListener('submit', async (e) => {
        e.preventDefault();
        const date = document.getElementById('event-input-date').value;
        const title = document.getElementById('event-input-title').value;
        const location = document.getElementById('event-input-location').value;
        const time = document.getElementById('event-input-time').value;
        const notice = document.getElementById('event-input-notice').value;
        const syncGoogleSheet = document.getElementById('event-input-gsheet').checked;

        try {
          const data = await api('/api/events', {
            method: 'POST',
            body: JSON.stringify({
              date,
              title,
              location,
              time,
              notice,
              syncGoogleSheet
            })
          });

          let toastMsg = data.message;
          if (data.googleSheet && data.googleSheet.message) {
            toastMsg += ` (${data.googleSheet.message})`;
          }

          if (window.ThApp) window.ThApp.showToast(toastMsg, 'success');
          modalCreate.classList.remove('active');
          formCreate.reset();

          await loadEvents();
          render();
          if (window.ThDashboard) window.ThDashboard.loadStats();
        } catch (err) {
          if (window.ThApp) window.ThApp.showToast(err.message, 'error');
        }
      });
    }

    // 2. 일정 수정 / 변경 / 삭제 모달
    const modalEdit = document.getElementById('modal-event-edit');
    const closeEditBtn = document.getElementById('btn-close-event-edit');
    const formEdit = document.getElementById('form-edit-event');
    const modalDeleteBtn = document.getElementById('btn-edit-modal-delete');

    if (closeEditBtn && modalEdit) {
      closeEditBtn.addEventListener('click', () => modalEdit.classList.remove('active'));
    }

    if (modalEdit) {
      modalEdit.addEventListener('click', (e) => {
        if (e.target === modalEdit) modalEdit.classList.remove('active');
      });
    }

    if (formEdit) {
      formEdit.addEventListener('submit', async (e) => {
        e.preventDefault();
        const eventId = document.getElementById('event-edit-id').value;
        const date = document.getElementById('event-edit-date').value;
        const title = document.getElementById('event-edit-title').value;
        const location = document.getElementById('event-edit-location').value;
        const time = document.getElementById('event-edit-time').value;
        const notice = document.getElementById('event-edit-notice').value;
        const status = document.getElementById('event-edit-status').value;
        const syncGoogleSheet = document.getElementById('event-edit-gsheet').checked;

        try {
          const data = await api(`/api/events/${eventId}`, {
            method: 'PUT',
            body: JSON.stringify({
              date,
              title,
              location,
              time,
              notice,
              status,
              syncGoogleSheet
            })
          });

          const data = await res.json();
          if (!res.ok) throw new Error(data.error);

          let toastMsg = data.message;
          if (data.googleSheet && data.googleSheet.message) {
            toastMsg += ` (${data.googleSheet.message})`;
          }

          if (window.ThApp) window.ThApp.showToast(toastMsg, 'success');
          modalEdit.classList.remove('active');

          await loadEvents();
          render();
          if (window.ThDashboard) window.ThDashboard.loadStats();
        } catch (err) {
          if (window.ThApp) window.ThApp.showToast(err.message, 'error');
        }
      });
    }

    if (modalDeleteBtn) {
      modalDeleteBtn.addEventListener('click', async () => {
        const eventId = document.getElementById('event-edit-id').value;
        const eventTitle = document.getElementById('event-edit-title').value;
        const eventDate = document.getElementById('event-edit-date').value;
        await deleteEventById(eventId, eventTitle, eventDate);
        if (modalEdit) modalEdit.classList.remove('active');
      });
    }
  }

  // 관리자 전용 UI 노출 제어 (버튼은 항상 보이되 텍스트/스타일 조정)
  function updateAdminVisibility() {
    const user = window.ThAuth ? window.ThAuth.getUser() : null;
    const isAdminOrRoot = user && (user.role === 'admin' || user.role === 'root');

    const createBtn = document.getElementById('btn-open-event-create');
    if (createBtn) {
      if (isAdminOrRoot) {
        createBtn.innerHTML = '<span>➕</span> 봉사 일정 등록 (Admin)';
        createBtn.style.opacity = '1';
      } else {
        createBtn.innerHTML = '<span>🔒</span> 봉사 일정 등록 (Admin)';
        createBtn.style.opacity = '0.85';
      }
    }

    const drawerAdminActions = document.getElementById('drawer-admin-actions');
    if (drawerAdminActions) {
      drawerAdminActions.style.display = isAdminOrRoot ? 'flex' : 'none';
    }
  }

  // 캘린더 렌더링
  function render() {
    const titleEl = document.getElementById('cal-month-title');
    if (titleEl) {
      const monthStr = String(currentMonth).padStart(2, '0');
      titleEl.innerHTML = `${currentYear}.${monthStr} <span style="font-size:0.8rem;color:#94A3B8;">▼</span>`;
    }

    const gridEl = document.getElementById('calendar-days-grid');
    if (!gridEl) return;
    gridEl.innerHTML = '';

    const firstDay = new Date(currentYear, currentMonth - 1, 1);
    const lastDay = new Date(currentYear, currentMonth, 0);

    const prevLastDay = new Date(currentYear, currentMonth - 1, 0);
    const startDayOfWeek = firstDay.getDay();
    const totalDays = lastDay.getDate();

    // 1. 이전 달 잔여 일자
    for (let i = startDayOfWeek - 1; i >= 0; i--) {
      const dayNum = prevLastDay.getDate() - i;
      const cell = createDayCell(dayNum, true, null);
      gridEl.appendChild(cell);
    }

    // 2. 이번 달 일자
    for (let day = 1; day <= totalDays; day++) {
      const dateStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const dayOfWeek = new Date(currentYear, currentMonth - 1, day).getDay();
      const event = eventsData.find(e => e.date === dateStr);

      const cell = createDayCell(day, false, dateStr, dayOfWeek, event);
      gridEl.appendChild(cell);
    }

    // 3. 다음 달 잔여 일자
    const currentCells = startDayOfWeek + totalDays;
    const remainingCells = currentCells % 7 === 0 ? 0 : 7 - (currentCells % 7);
    for (let nextDay = 1; nextDay <= remainingCells; nextDay++) {
      const cell = createDayCell(nextDay, true, null);
      gridEl.appendChild(cell);
    }

    updateAdminVisibility();
  }

  function createDayCell(dayNum, isOtherMonth, dateStr, dayOfWeek = 0, event = null) {
    const cell = document.createElement('div');
    cell.className = 'cal-day-cell';

    if (isOtherMonth) {
      cell.classList.add('other-month');
      cell.innerHTML = `
        <div class="day-header">
          <span class="day-num">${dayNum}</span>
        </div>
      `;
      return cell;
    }

    if (dayOfWeek === 0) cell.classList.add('day-sunday');
    if (dayOfWeek === 6) cell.classList.add('day-saturday');

    if (dateStr === '2026-09-09') {
      cell.classList.add('today');
    }

    let holidayInfo = holidays[dateStr];
    let holidayHtml = '';
    if (holidayInfo) {
      if (holidayInfo.isRed) cell.classList.add('day-holiday');
      holidayHtml = `<div class="memorial-text ${holidayInfo.isRed ? 'memorial-red' : ''}">${holidayInfo.name}</div>`;
    }

    let eventHtml = '';
    if (event) {
      cell.classList.add('volunteer-day');
      if (event.isAppliedByMe) {
        cell.classList.add('has-applied');
      }

      const isCompleted = event.status === 'COMPLETED' || new Date(event.date) < new Date('2026-09-09');
      const badgeClass = isCompleted ? 'completed' : (event.isAppliedByMe ? 'applied' : '');
      const badgeText = isCompleted ? '봉사완료' : (event.isAppliedByMe ? '신청완료' : '원무부 봉사');

      eventHtml = `
        <div class="volunteer-badge-pill ${badgeClass}">
          <span>🤝 ${badgeText}</span>
          <span class="badge-applicants">${event.applicantCount}명</span>
        </div>
      `;

      cell.addEventListener('click', () => openEventDetail(event.id));
    }

    if (dayOfWeek === 4) {
      cell.classList.add('thursday-cell');
      if (event) {
        cell.title = `[더블클릭] "${event.title}" 일정 수정 / 변경 / 삭제`;
      } else {
        cell.title = `[더블클릭] ${dateStr} (목요일) 봉사 일정 신규 등록`;
      }
    } else if (event) {
      cell.title = `[더블클릭] "${event.title}" 일정 수정 / 변경 / 삭제`;
    }

    // 목요일 또는 일정 셀 더블 클릭 시 일정 등록 / 수정 / 변경 / 삭제 모달 트리거
    cell.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      handleDayCellDoubleClick(dateStr, dayOfWeek, event);
    });

    let lunarHtml = '';
    if (dateStr === '2026-09-11') lunarHtml = '<span class="lunar-text">음8.1</span>';
    if (dateStr === '2026-09-25') lunarHtml = '<span class="lunar-text">음8.15</span>';

    cell.innerHTML = `
      <div class="day-header">
        <span class="day-num">${dayNum}</span>
        ${lunarHtml}
      </div>
      ${holidayHtml}
      ${eventHtml}
    `;

    return cell;
  }

  // 상세 드로어 열기
  async function openEventDetail(eventId) {
    try {
      const data = await api(`/api/events/${eventId}`);
      if (!data.success) throw new Error(data.error);

      currentSelectedEvent = data;
      renderDrawer(data);

      const panel = document.getElementById('drawer-panel');
      const overlay = document.getElementById('drawer-overlay');
      if (panel) panel.classList.add('active');
      if (overlay) overlay.classList.add('active');
      updateAdminVisibility();
    } catch (e) {
      console.error('Error opening event:', e);
      if (window.ThApp) window.ThApp.showToast('일정 정보를 불러오지 못했습니다.', 'error');
    }
  }

  function closeDrawer() {
    const panel = document.getElementById('drawer-panel');
    const overlay = document.getElementById('drawer-overlay');
    if (panel) panel.classList.remove('active');
    if (overlay) overlay.classList.remove('active');
    currentSelectedEvent = null;
  }

  function renderDrawer(data) {
    const { event, attendances, applicantCount, isAppliedByMe } = data;
    const currentUser = window.ThAuth ? window.ThAuth.getUser() : null;

    document.getElementById('drawer-event-date').innerText = `📅 ${event.date} (목요일)`;
    document.getElementById('drawer-event-title').innerText = event.title;
    document.getElementById('drawer-event-time').innerText = event.time || '17:30 ~ 19:00';
    document.getElementById('drawer-event-location').innerText = event.location || '어울림센터';
    document.getElementById('drawer-event-notice').innerText = event.notice || '17시 30분 업무인계 후 참석 바랍니다.';
    document.getElementById('drawer-attendees-count').innerText = `${applicantCount}명`;

    const applyBtn = document.getElementById('btn-apply-toggle');
    if (applyBtn) {
      if (!currentUser) {
        applyBtn.className = 'btn-apply-toggle apply';
        applyBtn.innerHTML = '🔒 로그인 후 참가 신청하기';
      } else if (isAppliedByMe) {
        applyBtn.className = 'btn-apply-toggle cancel';
        applyBtn.innerHTML = '✕ 봉사 참가 신청 취소';
      } else {
        applyBtn.className = 'btn-apply-toggle apply';
        applyBtn.innerHTML = '✋ 봉사 참가 신청하기';
      }
    }

    const listEl = document.getElementById('drawer-attendees-list');
    if (!listEl) return;
    listEl.innerHTML = '';

    if (attendances.length === 0) {
      listEl.innerHTML = '<div style="text-align:center;padding:2rem;color:#94A3B8;font-size:0.9rem;">아직 신청한 회원이 없습니다.<br>첫 번째로 봉사에 참가해 보세요!</div>';
      return;
    }

    const team1List = attendances.filter(a => a.team === '1조' || a.team === 'A조');
    const team2List = attendances.filter(a => a.team === '2조' || a.team === 'B조');

    let html = '';

    if (team1List.length > 0) {
      html += `<div style="font-size:0.8rem;font-weight:700;color:var(--team1);margin:0.5rem 0 0.3rem;">🔹 1조 (${team1List.length}명)</div>`;
      team1List.forEach(a => {
        const isMyRecord = currentUser && a.memberName === (currentUser.memberName || currentUser.name);
        html += `
          <div class="attendee-row">
            <span class="attendee-name">
              <span>👤 ${a.memberName}</span>
              ${isMyRecord ? '<span class="badge-tag badge-team1">나</span>' : ''}
            </span>
            <span class="badge-tag" style="background:#F1F5F9;color:#64748B;">${a.status === 'ATTENDED' ? '출석확정' : '신청완료'}</span>
          </div>
        `;
      });
    }

    if (team2List.length > 0) {
      html += `<div style="font-size:0.8rem;font-weight:700;color:var(--team2);margin:0.8rem 0 0.3rem;">🔸 2조 (${team2List.length}명)</div>`;
      team2List.forEach(a => {
        const isMyRecord = currentUser && a.memberName === (currentUser.memberName || currentUser.name);
        html += `
          <div class="attendee-row">
            <span class="attendee-name">
              <span>👤 ${a.memberName}</span>
              ${isMyRecord ? '<span class="badge-tag badge-team2">나</span>' : ''}
            </span>
            <span class="badge-tag" style="background:#F1F5F9;color:#64748B;">${a.status === 'ATTENDED' ? '출석확정' : '신청완료'}</span>
          </div>
        `;
      });
    }

    listEl.innerHTML = html;
  }

  // 참가 신청/취소 토글
  async function handleApplyToggle() {
    const currentUser = window.ThAuth ? window.ThAuth.getUser() : null;
    if (!currentUser) {
      if (window.ThApp) window.ThApp.showToast('봉사 신청은 로그인이 필요합니다.', 'error');
      if (window.ThAuth) window.ThAuth.openAuthModal('login');
      return;
    }

    if (!currentSelectedEvent) return;

    try {
      const eventId = currentSelectedEvent.event.id;
      const data = await api(`/api/events/${eventId}/apply`, {
        method: 'POST',
        body: JSON.stringify({
          memberName: currentUser.memberName || currentUser.name,
          team: currentUser.team || '1조'
        })
      });

      if (window.ThApp) window.ThApp.showToast(data.message, data.applied ? 'success' : 'info');

      await loadEvents();
      render();
      await openEventDetail(eventId);
      if (window.ThDashboard) window.ThDashboard.loadStats();
    } catch (e) {
      console.error('Apply error:', e);
      if (window.ThApp) window.ThApp.showToast(e.message, 'error');
    }
  }

  // 관리자 일정 삭제 공통 함수
  async function deleteEventById(eventId, title, date) {
    if (!confirm(`정말 "${title || '봉사'}" (${date || eventId}) 일정을 삭제하시겠습니까?\n해당 일자의 모든 참석 신청 데이터도 함께 삭제됩니다.`)) {
      return;
    }

    try {
      const data = await api(`/api/events/${eventId}`, { method: 'DELETE' });

      if (window.ThApp) window.ThApp.showToast(data.message, 'info');
      closeDrawer();
      await loadEvents();
      render();
      if (window.ThDashboard) window.ThDashboard.loadStats();
    } catch (err) {
      if (window.ThApp) window.ThApp.showToast(err.message, 'error');
    }
  }

  return {
    init,
    render,
    refresh: async () => {
      await loadEvents();
      render();
      updateAdminVisibility();
    },
    openEventDetail,
    updateAdminVisibility
  };
})();
