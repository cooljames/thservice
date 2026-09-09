/* ============================================================
   thservice: 대시보드 KPI 및 원무부 통계 모듈
   ============================================================ */

window.ThDashboard = (function () {
  'use strict';

  let currentStats = null;

  async function init() {
    await loadStats();
    await loadMembersRoster();
    setupDragAndDrop();
  }

  // 대시보드 통계 데이터 가져오기
  async function loadStats() {
    try {
      const data = await window.ThAuth.apiRequest('/api/dashboard', { method: 'GET' });
      if (data.success) {
        currentStats = data.stats;
        renderKpi(data.stats);
        renderParticipationChart(data.stats.leaderboard);
      }
    } catch (e) {
      console.error('Failed to load dashboard stats:', e);
    }
  }

  // KPI 카드 렌더링
  function renderKpi(stats) {
    const { kpi, myStats } = stats;

    const totalEventsEl = document.getElementById('kpi-total-events');
    const totalPartsEl = document.getElementById('kpi-total-parts');
    const nextDDayEl = document.getElementById('kpi-next-dday');
    const nextDateEl = document.getElementById('kpi-next-date');
    const avgPerEventEl = document.getElementById('kpi-avg-parts');

    if (totalEventsEl) totalEventsEl.innerText = `${kpi.completedEvents}회`;
    if (totalPartsEl) totalPartsEl.innerText = `${kpi.totalParticipations}명`;
    if (avgPerEventEl) avgPerEventEl.innerText = `${kpi.avgPerEvent}명`;

    if (nextDDayEl && kpi.nextEvent) {
      nextDDayEl.innerText = kpi.nextEventDDay || 'D-Day';
      if (nextDateEl) nextDateEl.innerText = `${kpi.nextEvent.date} (${kpi.nextEvent.targetTeam || '전체'})`;
    } else if (nextDDayEl) {
      nextDDayEl.innerText = '-';
      if (nextDateEl) nextDateEl.innerText = '예정된 봉사 없음';
    }

    // 개인 통계 카드 (로그인 시)
    const myKpiCard = document.getElementById('kpi-my-stats-card');
    const myCountEl = document.getElementById('kpi-my-count');
    const myRateEl = document.getElementById('kpi-my-rate');
    if (myKpiCard) {
      if (myStats) {
        myKpiCard.style.display = 'flex';
        if (myCountEl) myCountEl.innerText = `${myStats.count}회`;
        if (myRateEl) myRateEl.innerText = `출석률 ${myStats.attendanceRate}% (${myStats.team})`;
      } else {
        myKpiCard.style.display = 'none';
      }
    }
  }

  // 전체 인원 참여 상황 (막대 그래프)
  let participationChart = null;

  function renderParticipationChart(leaderboard) {
    const ctx = document.getElementById('participation-chart');
    if (!ctx) return;

    if (participationChart) {
      participationChart.destroy();
    }

    const labels = leaderboard.map(m => m.name);
    const data = leaderboard.map(m => m.count);
    const bgColors = leaderboard.map(m => m.team === '1조' || m.team === 'A조' ? 'rgba(99, 102, 241, 0.7)' : 'rgba(236, 72, 153, 0.7)');
    const borderColors = leaderboard.map(m => m.team === '1조' || m.team === 'A조' ? 'rgba(99, 102, 241, 1)' : 'rgba(236, 72, 153, 1)');

    participationChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: '누적 참여 횟수',
          data: data,
          backgroundColor: bgColors,
          borderColor: borderColors,
          borderWidth: 1,
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              stepSize: 1
            }
          }
        },
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            callbacks: {
              label: function(context) {
                const item = leaderboard[context.dataIndex];
                return `${item.team} | ${item.count}회 참여`;
              }
            }
          }
        }
      }
    });
  }

  // 조편성 명단 로드
  async function loadMembersRoster() {
    try {
      const data = await window.ThAuth.apiRequest('/api/members', { method: 'GET' });
      if (!data.success) return;

      renderTeamRoster('team1-members-grid', data.team1.members, '1조');
      renderTeamRoster('team2-members-grid', data.team2.members, '2조');
    } catch (e) {
      console.error('Failed to load members:', e);
    }
  }

  function renderTeamRoster(containerId, members, targetTeam) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = '';
    el.dataset.team = targetTeam;

    const currentUser = window.ThAuth ? window.ThAuth.getUser() : null;
    const isAdmin = currentUser && currentUser.isAdmin;

    members.forEach(m => {
      const chip = document.createElement('div');
      chip.className = `member-chip ${m.isLeader ? 'leader' : ''}`;
      
      if (isAdmin) {
        chip.draggable = true;
        chip.dataset.id = m.id;
        chip.style.cursor = 'grab';
        
        chip.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('text/plain', m.id);
          chip.style.opacity = '0.5';
        });
        chip.addEventListener('dragend', (e) => {
          chip.style.opacity = '1';
        });
      }

      chip.innerHTML = `
        <span>${m.isLeader ? '👑 ' : ''}${m.name}</span>
        ${m.isLeader ? '<span style="font-size:0.7rem;color:#92400E;">조장</span>' : ''}
      `;
      el.appendChild(chip);
    });
  }

  // 드래그 앤 드롭 조 편성 변경
  function setupDragAndDrop() {
    const dropZones = [
      document.getElementById('team1-members-grid'),
      document.getElementById('team2-members-grid')
    ];

    dropZones.forEach(zone => {
      if (!zone) return;

      zone.addEventListener('dragover', (e) => {
        e.preventDefault();
        const el = zone.closest('.team-roster-column');
        if (el) el.style.backgroundColor = 'var(--surface-hover)';
      });

      zone.addEventListener('dragleave', (e) => {
        const el = zone.closest('.team-roster-column');
        if (el) el.style.backgroundColor = '';
      });

      zone.addEventListener('drop', async (e) => {
        e.preventDefault();
        const el = zone.closest('.team-roster-column');
        if (el) el.style.backgroundColor = '';
        
        const memberId = e.dataTransfer.getData('text/plain');
        if (!memberId) return;

        const newTeam = el.dataset.team;
        try {
          const data = await window.ThAuth.apiRequest(`/api/members/${memberId}/team`, {
            method: 'PUT',
            body: JSON.stringify({ team: newTeam })
          });
          if (data.success) {
            loadMembersRoster();
            loadStats();
          } else {
            alert('조 변경 실패: ' + data.error);
          }
        } catch (err) {
          console.error(err);
          alert('조 변경 처리 실패: ' + err.message);
        }
      });
    });
  }

  return {
    init,
    loadStats,
    loadMembersRoster
  };
})();
