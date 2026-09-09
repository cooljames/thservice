const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
require('dotenv').config();

// ============================================================
// 1. 데이터베이스 연결 설정 (Vercel Postgres / Neon / Supabase)
// ============================================================
const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_URL;

let pool = null;
if (connectionString) {
  const isLocalHost = connectionString.includes('localhost') || connectionString.includes('127.0.0.1');
  pool = new Pool({
    connectionString,
    ssl: isLocalHost ? false : { rejectUnauthorized: false }
  });
  console.log('📦 Database persistence: PostgreSQL (Vercel/Neon) connected.');
} else {
  console.log('📁 Database persistence: Local JSON file mode (Set DATABASE_URL in .env for PostgreSQL).');
}

// 3단계 역할 정의
// root: 최고 관리자 (모든 권한, 사용자 관리, 시스템 제어)
// admin: 관리자 (일정 등록/수정/삭제, 구글시트 생성, 출석 관리)
// user: 일반 회원 (봉사 신청/취소)
function normalizeRole(role) {
  if (role === 'root' || role === 'super_admin') return 'root';
  if (role === 'admin') return 'admin';
  return 'user';
}

// UUID 헬퍼
function toUuid(id) {
  if (!id) return crypto.randomUUID();
  const str = String(id);
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRegex.test(str)) {
    return str;
  }
  const hash = crypto.createHash('md5').update(str).digest('hex');
  return `${hash.substring(0, 8)}-${hash.substring(8, 12)}-${hash.substring(12, 16)}-${hash.substring(16, 20)}-${hash.substring(20, 32)}`;
}

// ============================================================
// 2. 로컬 JSON 파일 Fallback 관리 (Vercel 서버리스 대응)
// ============================================================
const IS_VERCEL = !!process.env.VERCEL;
const DATA_DIR = IS_VERCEL ? os.tmpdir() : path.join(__dirname, 'data');

function getFilePath(filename) {
  return path.join(DATA_DIR, filename);
}

function ensureJsonFile(filename, defaultData = []) {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const targetFile = getFilePath(filename);
    if (!fs.existsSync(targetFile)) {
      const seedFile = path.join(__dirname, 'data', filename);
      if (fs.existsSync(seedFile)) {
        fs.copyFileSync(seedFile, targetFile);
      } else {
        fs.writeFileSync(targetFile, JSON.stringify(defaultData, null, 2), 'utf-8');
      }
    }
  } catch (err) {
    console.error(`Error ensuring JSON file ${filename}:`, err);
  }
}

function readJson(filename, defaultData = []) {
  try {
    ensureJsonFile(filename, defaultData);
    const targetFile = getFilePath(filename);
    if (!fs.existsSync(targetFile)) return defaultData;
    const raw = fs.readFileSync(targetFile, 'utf-8');
    return JSON.parse(raw || '[]');
  } catch (err) {
    console.error(`Error reading ${filename}:`, err);
    return defaultData;
  }
}

function writeJson(filename, data) {
  try {
    ensureJsonFile(filename);
    const targetFile = getFilePath(filename);
    fs.writeFileSync(targetFile, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error(`Error writing ${filename}:`, err);
  }
}

// ============================================================
// 3. PostgreSQL 테이블 초기화 및 시드 데이터 동기화
// ============================================================
async function initDb() {
  if (!pool) {
    ensureJsonFile('users.json');
    ensureJsonFile('members.json');
    ensureJsonFile('events.json');
    ensureJsonFile('attendance.json');
    return;
  }

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) UNIQUE NOT NULL,
        name VARCHAR(255),
        picture TEXT,
        password TEXT,
        role VARCHAR(50) DEFAULT 'user',
        provider VARCHAR(50) DEFAULT 'email',
        member_name VARCHAR(100),
        team VARCHAR(50),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS members (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        team VARCHAR(50) NOT NULL,
        is_leader BOOLEAN DEFAULT FALSE,
        phone VARCHAR(50),
        note TEXT
      );

      CREATE TABLE IF NOT EXISTS events (
        id VARCHAR(50) PRIMARY KEY,
        date DATE NOT NULL,
        title VARCHAR(255) NOT NULL,
        location VARCHAR(255),
        time VARCHAR(100),
        notice TEXT,
        target_team VARCHAR(50) DEFAULT '전체',
        status VARCHAR(50) DEFAULT 'UPCOMING'
      );

      CREATE TABLE IF NOT EXISTS attendance (
        id SERIAL PRIMARY KEY,
        event_id VARCHAR(50) NOT NULL,
        member_name VARCHAR(100) NOT NULL,
        user_id UUID,
        team VARCHAR(50),
        status VARCHAR(50) DEFAULT 'APPLIED',
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(event_id, member_name)
      );
    `);

    // 시드 데이터 동기화 (테이블 비었을 때)
    const usersCount = (await pool.query('SELECT COUNT(*)::int as count FROM users')).rows[0].count;
    if (usersCount === 0) {
      const seedUsers = readJson('users.json');
      for (const u of seedUsers) {
        await pool.query(`
          INSERT INTO users (id, email, name, picture, password, role, provider, member_name, team, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
          ON CONFLICT (id) DO NOTHING
        `, [toUuid(u.id), u.email, u.name, u.picture || null, u.password || null, normalizeRole(u.role), u.provider || 'email', u.memberName || null, u.team || null]);
      }
    }

    const membersCount = (await pool.query('SELECT COUNT(*)::int as count FROM members')).rows[0].count;
    if (membersCount === 0) {
      const seedMembers = readJson('members.json');
      for (const m of seedMembers) {
        await pool.query(`
          INSERT INTO members (name, team, is_leader, phone, note)
          VALUES ($1, $2, $3, $4, $5)
        `, [m.name, m.team, !!m.isLeader, m.phone || null, m.note || null]);
      }
    }

    const eventsCount = (await pool.query('SELECT COUNT(*)::int as count FROM events')).rows[0].count;
    if (eventsCount === 0) {
      const seedEvents = readJson('events.json');
      for (const e of seedEvents) {
        await pool.query(`
          INSERT INTO events (id, date, title, location, time, notice, target_team, status)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (id) DO NOTHING
        `, [e.id, e.date, e.title, e.location, e.time, e.notice, e.targetTeam, e.status]);
      }
    }

    const attCount = (await pool.query('SELECT COUNT(*)::int as count FROM attendance')).rows[0].count;
    if (attCount === 0) {
      const seedAtt = readJson('attendance.json');
      for (const a of seedAtt) {
        await pool.query(`
          INSERT INTO attendance (event_id, member_name, team, status, created_at)
          VALUES ($1, $2, $3, $4, NOW())
          ON CONFLICT (event_id, member_name) DO NOTHING
        `, [a.eventId, a.memberName, a.team, a.status || 'APPLIED']);
      }
    }

    console.log('✅ PostgreSQL Schema & Seed checked successfully.');
  } catch (err) {
    console.error('⚠️ DB Initialization error:', err.message);
  }
}

initDb();

// ============================================================
// 4. 비즈니스 쿼리 및 데이터 조작 함수
// ============================================================

// --- [사용자 인증 및 권한 관리] ---
async function findUserById(id) {
  if (!id) return null;
  if (pool) {
    const res = await pool.query('SELECT * FROM users WHERE id = $1', [toUuid(id)]);
    const u = res.rows[0];
    if (u) u.role = normalizeRole(u.role);
    return u || null;
  }
  const users = readJson('users.json');
  const u = users.find(x => String(x.id) === String(id));
  if (u) u.role = normalizeRole(u.role);
  return u || null;
}

async function findUserByEmail(email) {
  if (!email) return null;
  if (pool) {
    const res = await pool.query('SELECT * FROM users WHERE LOWER(email) = LOWER($1)', [email.trim()]);
    const u = res.rows[0];
    if (u) u.role = normalizeRole(u.role);
    return u || null;
  }
  const users = readJson('users.json');
  const u = users.find(x => x.email.toLowerCase() === email.trim().toLowerCase());
  if (u) u.role = normalizeRole(u.role);
  return u || null;
}

async function createUser(userData) {
  const uuid = toUuid(userData.id);
  const email = userData.email.trim().toLowerCase();
  const role = normalizeRole(userData.role);

  if (pool) {
    const res = await pool.query(`
      INSERT INTO users (id, email, name, picture, password, role, provider, member_name, team, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        picture = EXCLUDED.picture,
        role = EXCLUDED.role,
        updated_at = NOW()
      RETURNING *
    `, [uuid, email, userData.name || null, userData.picture || null, userData.password || null, role, userData.provider || 'email', userData.memberName || null, userData.team || null]);
    const u = res.rows[0];
    if (u) u.role = normalizeRole(u.role);
    return u;
  }

  const users = readJson('users.json');
  const newUser = {
    id: uuid,
    email,
    name: userData.name || null,
    picture: userData.picture || null,
    password: userData.password || null,
    role,
    provider: userData.provider || 'email',
    memberName: userData.memberName || null,
    team: userData.team || null,
    created_at: new Date().toISOString()
  };
  const idx = users.findIndex(u => u.id === uuid || u.email === email);
  if (idx !== -1) {
    users[idx] = { ...users[idx], ...newUser };
  } else {
    users.push(newUser);
  }
  writeJson('users.json', users);
  return newUser;
}

// 전체 사용자 목록 (Root 전용)
async function getAllUsers() {
  if (pool) {
    const res = await pool.query('SELECT id, email, name, picture, role, provider, member_name, team, created_at FROM users ORDER BY created_at ASC');
    return res.rows.map(u => ({ ...u, role: normalizeRole(u.role) }));
  }
  const users = readJson('users.json');
  return users.map(u => ({
    id: u.id,
    email: u.email,
    name: u.name,
    picture: u.picture || null,
    role: normalizeRole(u.role),
    provider: u.provider || 'email',
    memberName: u.memberName || u.member_name || u.name,
    team: u.team || null,
    createdAt: u.created_at || u.createdAt
  }));
}

// 사용자 권한 변경 (Root 전용: root > admin > user)
async function updateUserRole(userId, newRole) {
  const role = normalizeRole(newRole);
  if (pool) {
    const res = await pool.query(
      'UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2 RETURNING id, email, name, role',
      [role, toUuid(userId)]
    );
    return res.rows[0] || null;
  }
  const users = readJson('users.json');
  const user = users.find(u => String(u.id) === String(userId));
  if (!user) return null;
  user.role = role;
  writeJson('users.json', users);
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

// 사용자 삭제 (Root 전용)
async function deleteUser(userId) {
  if (pool) {
    const res = await pool.query('DELETE FROM users WHERE id = $1 RETURNING id, email, name', [toUuid(userId)]);
    return res.rows[0] || null;
  }
  const users = readJson('users.json');
  const idx = users.findIndex(u => String(u.id) === String(userId));
  if (idx === -1) return null;
  const deleted = users.splice(idx, 1)[0];
  writeJson('users.json', users);
  return deleted;
}

// --- [실명 가입 검증 헬퍼] ---
async function findMemberByName(name) {
  if (!name) return null;
  const cleanName = name.trim();
  const members = await getAllMembers();
  return members.find(m => m.name === cleanName) || null;
}

async function isMemberNameAlreadyRegistered(name, excludeUserId = null) {
  if (!name) return false;
  const cleanName = name.trim();
  const allUsers = await getAllUsers();
  return allUsers.some(u => {
    if (excludeUserId && String(u.id) === String(excludeUserId)) return false;
    const memberName = u.memberName || u.member_name || u.name;
    return memberName === cleanName;
  });
}

// --- [원무부 회원 명단 & 조편성] ---
async function getAllMembers() {
  if (pool) {
    const res = await pool.query('SELECT * FROM members ORDER BY team ASC, is_leader DESC, name ASC');
    return res.rows.map(r => ({
      id: r.id,
      name: r.name,
      team: r.team,
      isLeader: r.is_leader,
      phone: r.phone,
      note: r.note
    }));
  }
  return readJson('members.json');
}

async function updateMemberTeam(memberId, newTeam) {
  if (pool) {
    const res = await pool.query('UPDATE members SET team = $1 WHERE id = $2 RETURNING *', [newTeam, parseInt(memberId, 10)]);
    return res.rows[0] ? {
      id: res.rows[0].id,
      name: res.rows[0].name,
      team: res.rows[0].team,
      isLeader: res.rows[0].is_leader,
      phone: res.rows[0].phone,
      note: res.rows[0].note
    } : null;
  }
  const members = readJson('members.json');
  const m = members.find(x => String(x.id) === String(memberId));
  if (m) {
    m.team = newTeam;
    writeJson('members.json', members);
    return m;
  }
  return null;
}


// --- [봉사 일정 (Events) CRUD] ---
async function getAllEvents() {
  if (pool) {
    const res = await pool.query('SELECT * FROM events ORDER BY date ASC');
    return res.rows.map(r => ({
      id: r.id,
      date: typeof r.date === 'string' ? r.date : r.date.toISOString().split('T')[0],
      title: r.title,
      location: r.location,
      time: r.time,
      notice: r.notice,
      targetTeam: r.target_team,
      status: r.status
    }));
  }
  return readJson('events.json');
}

async function getEventById(eventId) {
  if (pool) {
    const res = await pool.query('SELECT * FROM events WHERE id = $1', [eventId]);
    if (!res.rows[0]) return null;
    const r = res.rows[0];
    return {
      id: r.id,
      date: typeof r.date === 'string' ? r.date : r.date.toISOString().split('T')[0],
      title: r.title,
      location: r.location,
      time: r.time,
      notice: r.notice,
      targetTeam: r.target_team,
      status: r.status
    };
  }
  const events = readJson('events.json');
  return events.find(e => e.id === eventId) || null;
}

// 신규 일정 생성 (Admin / Root 전용)
async function createEvent(eventData) {
  const eventId = eventData.id || eventData.date;
  const targetTeam = eventData.targetTeam || '전체';
  const status = eventData.status || 'OPEN';

  if (pool) {
    const res = await pool.query(`
      INSERT INTO events (id, date, title, location, time, notice, target_team, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        location = EXCLUDED.location,
        time = EXCLUDED.time,
        notice = EXCLUDED.notice,
        target_team = EXCLUDED.target_team,
        status = EXCLUDED.status
      RETURNING *
    `, [eventId, eventData.date, eventData.title, eventData.location, eventData.time, eventData.notice, targetTeam, status]);
    const r = res.rows[0];
    return {
      id: r.id,
      date: typeof r.date === 'string' ? r.date : r.date.toISOString().split('T')[0],
      title: r.title,
      location: r.location,
      time: r.time,
      notice: r.notice,
      targetTeam: r.target_team,
      status: r.status
    };
  }

  const events = readJson('events.json');
  const newEvent = {
    id: eventId,
    date: eventData.date,
    title: eventData.title,
    location: eventData.location,
    time: eventData.time,
    notice: eventData.notice,
    targetTeam,
    status
  };

  const idx = events.findIndex(e => e.id === eventId);
  if (idx !== -1) {
    events[idx] = newEvent;
  } else {
    events.push(newEvent);
    events.sort((a, b) => a.date.localeCompare(b.date));
  }
  writeJson('events.json', events);
  return newEvent;
}

// 일정 수정 (Admin / Root 전용)
async function updateEvent(eventId, updateData) {
  if (pool) {
    const res = await pool.query(`
      UPDATE events
      SET title = COALESCE($1, title),
          location = COALESCE($2, location),
          time = COALESCE($3, time),
          notice = COALESCE($4, notice),
          target_team = COALESCE($5, target_team),
          status = COALESCE($6, status),
          date = COALESCE($7, date)
      WHERE id = $8
      RETURNING *
    `, [updateData.title, updateData.location, updateData.time, updateData.notice, updateData.targetTeam, updateData.status, updateData.date, eventId]);
    return res.rows[0] || null;
  }

  const events = readJson('events.json');
  const event = events.find(e => e.id === eventId);
  if (!event) return null;

  const oldId = event.id;
  const newDate = updateData.date || event.date;

  Object.assign(event, updateData);
  event.date = newDate;

  if (updateData.date && updateData.date !== oldId) {
    event.id = updateData.date;
    const attList = readJson('attendance.json');
    attList.forEach(a => {
      if (a.eventId === oldId) a.eventId = updateData.date;
    });
    writeJson('attendance.json', attList);
  }

  events.sort((a, b) => a.date.localeCompare(b.date));
  writeJson('events.json', events);
  return event;
}

// 일정 삭제 (Admin / Root 전용)
async function deleteEvent(eventId) {
  if (pool) {
    await pool.query('DELETE FROM attendance WHERE event_id = $1', [eventId]);
    const res = await pool.query('DELETE FROM events WHERE id = $1 RETURNING *', [eventId]);
    return res.rows[0] || null;
  }

  const events = readJson('events.json');
  const idx = events.findIndex(e => e.id === eventId);
  if (idx === -1) return null;
  const deleted = events.splice(idx, 1)[0];
  writeJson('events.json', events);

  // 해당 일정의 참석 기록도 삭제
  const attList = readJson('attendance.json');
  const filtered = attList.filter(a => a.eventId !== eventId);
  writeJson('attendance.json', filtered);

  return deleted;
}

// --- [참석 / 신청 현황 (Attendance)] ---
async function getAttendanceByEvent(eventId) {
  if (pool) {
    const res = await pool.query(`
      SELECT a.*, u.name as user_display_name, u.email as user_email
      FROM attendance a
      LEFT JOIN users u ON a.user_id = u.id
      WHERE a.event_id = $1
      ORDER BY a.team ASC, a.member_name ASC
    `, [eventId]);
    return res.rows.map(r => ({
      id: r.id,
      eventId: r.event_id,
      memberName: r.member_name,
      userId: r.user_id,
      team: r.team,
      status: r.status,
      createdAt: r.created_at
    }));
  }
  const attList = readJson('attendance.json');
  return attList.filter(a => a.eventId === eventId);
}

async function getAllAttendance() {
  if (pool) {
    const res = await pool.query('SELECT * FROM attendance');
    return res.rows.map(r => ({
      id: r.id,
      eventId: r.event_id,
      memberName: r.member_name,
      userId: r.user_id,
      team: r.team,
      status: r.status,
      createdAt: r.created_at
    }));
  }
  return readJson('attendance.json');
}

// 참가 신청 / 취소 토글
async function toggleEventApplication(eventId, memberName, team, userId = null) {
  if (pool) {
    const existing = await pool.query(
      'SELECT * FROM attendance WHERE event_id = $1 AND member_name = $2',
      [eventId, memberName]
    );
    if (existing.rows.length > 0) {
      await pool.query('DELETE FROM attendance WHERE event_id = $1 AND member_name = $2', [eventId, memberName]);
      return { applied: false, memberName };
    } else {
      const res = await pool.query(`
        INSERT INTO attendance (event_id, member_name, team, user_id, status, created_at)
        VALUES ($1, $2, $3, $4, 'APPLIED', NOW())
        RETURNING *
      `, [eventId, memberName, team, userId ? toUuid(userId) : null]);
      return { applied: true, data: res.rows[0] };
    }
  }

  const attList = readJson('attendance.json');
  const idx = attList.findIndex(a => a.eventId === eventId && a.memberName === memberName);
  if (idx !== -1) {
    attList.splice(idx, 1);
    writeJson('attendance.json', attList);
    return { applied: false, memberName };
  } else {
    const newRecord = {
      eventId,
      memberName,
      team: team || '1조',
      userId,
      status: 'APPLIED',
      createdAt: new Date().toISOString()
    };
    attList.push(newRecord);
    writeJson('attendance.json', attList);
    return { applied: true, data: newRecord };
  }
}

// 관리자 출석 확정 토글
async function updateAttendanceStatus(eventId, memberName, status) {
  if (pool) {
    const res = await pool.query(`
      UPDATE attendance SET status = $1 WHERE event_id = $2 AND member_name = $3 RETURNING *
    `, [status, eventId, memberName]);
    return res.rows[0];
  }
  const attList = readJson('attendance.json');
  const record = attList.find(a => a.eventId === eventId && a.memberName === memberName);
  if (record) {
    record.status = status;
    writeJson('attendance.json', attList);
  }
  return record;
}

// --- [대시보드 통계 계산] ---
async function getDashboardStats(currentUser = null) {
  const events = await getAllEvents();
  const attendances = await getAllAttendance();
  const members = await getAllMembers();

  const totalEvents = events.length;
  const completedEvents = events.filter(e => e.status === 'COMPLETED' || new Date(e.date) < new Date('2026-09-09')).length;
  const totalParticipations = attendances.length;

  const today = '2026-09-09';
  const upcomingEvents = events.filter(e => e.date >= today);
  const nextEvent = upcomingEvents[0] || null;

  let nextEventDDay = null;
  if (nextEvent) {
    const eventDate = new Date(nextEvent.date);
    const currDate = new Date(today);
    const diffTime = eventDate - currDate;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    nextEventDDay = diffDays === 0 ? 'D-Day' : (diffDays > 0 ? `D-${diffDays}` : `D+${Math.abs(diffDays)}`);
  }

  let team1Count = 0;
  let team2Count = 0;
  attendances.forEach(a => {
    if (a.team === '1조' || a.team === 'A조') team1Count++;
    else if (a.team === '2조' || a.team === 'B조') team2Count++;
  });

  const memberCountMap = {};
  members.forEach(m => {
    memberCountMap[m.name] = {
      name: m.name,
      team: m.team,
      isLeader: m.isLeader,
      count: 0
    };
  });

  attendances.forEach(a => {
    if (!memberCountMap[a.memberName]) {
      memberCountMap[a.memberName] = {
        name: a.memberName,
        team: a.team || '1조',
        isLeader: false,
        count: 0
      };
    }
    memberCountMap[a.memberName].count++;
  });

  const leaderboard = Object.values(memberCountMap)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ko'));

  let myStats = null;
  if (currentUser) {
    const myName = currentUser.memberName || currentUser.name;
    const myRecord = leaderboard.find(l => l.name === myName);
    myStats = {
      name: myName,
      team: currentUser.team || (myRecord ? myRecord.team : '미지정'),
      count: myRecord ? myRecord.count : 0,
      attendanceRate: completedEvents > 0 && myRecord ? Math.round((myRecord.count / completedEvents) * 100) : 0
    };
  }

  return {
    kpi: {
      totalEvents,
      completedEvents,
      totalParticipations,
      avgPerEvent: completedEvents > 0 ? (totalParticipations / completedEvents).toFixed(1) : 0,
      nextEvent,
      nextEventDDay
    },
    teams: {
      team1: { name: '1조 (A조 - 조장 서옥영)', count: team1Count, memberCount: members.filter(m => m.team === '1조').length },
      team2: { name: '2조 (B조 - 조장 변승원)', count: team2Count, memberCount: members.filter(m => m.team === '2조').length }
    },
    leaderboard,
    myStats
  };
}

module.exports = {
  isDbActive: () => !!pool,
  initDb,
  toUuid,
  normalizeRole,
  // User
  findUserById,
  findUserByEmail,
  createUser,
  getAllUsers,
  updateUserRole,
  deleteUser,
  // Member Validation & Roster
  findMemberByName,
  isMemberNameAlreadyRegistered,
  getAllMembers,
  updateMemberTeam,
  // Events
  getAllEvents,
  getEventById,
  createEvent,
  updateEvent,
  deleteEvent,
  // Attendance
  getAttendanceByEvent,
  getAllAttendance,
  toggleEventApplication,
  updateAttendanceStatus,
  // Dashboard
  getDashboardStats
};
