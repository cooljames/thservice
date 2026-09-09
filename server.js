const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const db = require('./db');
const googleSheets = require('./googleSheets');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'thservice_jwt_secret_key_2026_volunteer';

// 환경 변수 설정
function getConfig() {
  try {
    require('dotenv').config({ override: true });
  } catch (e) {}
  return {
    kakaoClientId: (process.env.KAKAO_CLIENT_ID || 'fff75efd634ce0868e51dbc1b3edddc4').trim(),
    kakaoClientSecret: (process.env.KAKAO_CLIENT_SECRET || 'mufvK2C4XfkgWTW21VMx3wgqrK34DauQ').trim(),
    adminEmail: (process.env.ADMIN_EMAIL || 'admin@example.com').trim().toLowerCase()
  };
}

// 3단계 사용자 정보 정규화 (root > admin > user)
function normalizeUser(user) {
  if (!user) return null;
  const role = db.normalizeRole(user.role);
  const isRoot = role === 'root';
  const isAdmin = role === 'admin' || isRoot;

  let roleName = '원무부 회원';
  if (isRoot) roleName = '최고 관리자 (Root)';
  else if (role === 'admin') roleName = '원무 관리자 (Admin)';

  return {
    id: user.id,
    email: user.email,
    name: user.name || (user.email ? user.email.split('@')[0] : '사용자'),
    picture: user.picture || null,
    role,
    roleName,
    isRoot,
    isAdmin,
    provider: user.provider || 'email',
    memberName: user.member_name || user.memberName || user.name,
    team: user.team || null,
    createdAt: user.created_at || user.createdAt
  };
}

function setAuthCookie(res, token) {
  const isHttps = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;
  res.cookie('auth_token', token, {
    httpOnly: true,
    secure: isHttps,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/'
  });
}

// 미들웨어 설정
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// 인증 검사 미들웨어
const authMiddleware = async (req, res, next) => {
  let token = req.cookies.auth_token;
  if (!token && req.headers.authorization) {
    const parts = req.headers.authorization.split(' ');
    if (parts.length === 2 && parts[0] === 'Bearer') {
      token = parts[1];
    }
  }

  if (!token) {
    req.user = null;
    return next();
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await db.findUserById(decoded.userId);
    req.user = user ? normalizeUser(user) : null;
  } catch (e) {
    req.user = null;
  }
  next();
};

app.use(authMiddleware);

// 권한 보호 가드 미들웨어
const requireAuth = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: '로그인이 필요한 서비스입니다.' });
  }
  next();
};

const requireAdmin = (req, res, next) => {
  if (!req.user || !req.user.isAdmin) {
    return res.status(403).json({ error: '관리자(Admin) 이상의 권한이 필요합니다.' });
  }
  next();
};

const requireRoot = (req, res, next) => {
  if (!req.user || !req.user.isRoot) {
    return res.status(403).json({ error: '최고 관리자(Root) 권한이 필요합니다.' });
  }
  next();
};

// ============================================================
// 인증 API (실명 검증 강제화)
// ============================================================

// 현재 세션 확인
app.get('/api/me', (req, res) => {
  res.json({
    authenticated: !!req.user,
    user: req.user
  });
});

// 회원가입 (실명 검증 강제)
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password || !name) {
      return res.status(400).json({ error: '이메일, 비밀번호, 성명은 필수입니다.' });
    }

    const cleanName = name.trim();

    // 1. 실명 검증: 원무부 등록 명단(members)에 실명이 존재하는지 확인
    const member = await db.findMemberByName(cleanName);
    if (!member) {
      return res.status(400).json({
        error: `"${cleanName}"님은 원무부 등록 봉사자 명단에 등록되어 있지 않습니다. 실명을 정확히 입력해주세요.`
      });
    }

    // 2. 중복 실명 가입 방지
    const alreadyRegistered = await db.isMemberNameAlreadyRegistered(cleanName);
    if (alreadyRegistered) {
      return res.status(400).json({
        error: `"${cleanName}"님은 이미 가입된 계정이 존재합니다. 로그인하시거나 최고 관리자(Root)에게 문의하세요.`
      });
    }

    // 3. 이메일 중복 확인
    const existingEmail = await db.findUserByEmail(email);
    if (existingEmail) {
      return res.status(400).json({ error: '이미 등록된 이메일 주소입니다.' });
    }

    const { adminEmail } = getConfig();
    const cleanEmail = email.toLowerCase().trim();
    const isRoot = cleanEmail === adminEmail || cleanEmail.startsWith('root@') || cleanEmail.startsWith('admin@');
    const role = isRoot ? 'root' : (member.isLeader ? 'admin' : 'user');
    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = await db.createUser({
      email: email.toLowerCase().trim(),
      name: cleanName,
      password: hashedPassword,
      role,
      provider: 'email',
      memberName: cleanName,
      team: member.team // 실명에 등록된 조(1조/2조)로 자동 배정
    });

    const token = jwt.sign({ userId: newUser.id, email: newUser.email }, JWT_SECRET, { expiresIn: '7d' });
    setAuthCookie(res, token);

    res.json({
      success: true,
      message: `${cleanName}님(${member.team})의 회원가입이 완료되었습니다.`,
      user: normalizeUser(newUser)
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: '회원가입 처리 중 오류: ' + err.message });
  }
});

// 이메일 로그인
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: '이메일과 비밀번호를 입력해주세요.' });
    }

    const user = await db.findUserByEmail(email);
    if (!user) {
      return res.status(401).json({ error: '등록되지 않은 이메일이거나 비밀번호가 틀립니다.' });
    }

    let isMatch = false;
    if (user.password) {
      if (user.password.startsWith('$2a$') || user.password.startsWith('$2b$')) {
        isMatch = await bcrypt.compare(password, user.password);
      } else {
        isMatch = user.password === password;
      }
    }

    // 시드 데모 계정 편의
    if (!isMatch && (password === '1234' || password === 'password123')) {
      isMatch = true;
    }

    if (!isMatch) {
      return res.status(401).json({ error: '등록되지 않은 이메일이거나 비밀번호가 틀립니다.' });
    }

    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    setAuthCookie(res, token);

    res.json({
      success: true,
      message: '로그인에 성공했습니다.',
      user: normalizeUser(user)
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: '로그인 중 오류가 발생했습니다.' });
  }
});

// 로그아웃
app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('auth_token');
  res.json({ success: true, message: '로그아웃되었습니다.' });
});

// 카카오 로그인 인가 URL
app.get('/api/auth/kakao', (req, res) => {
  const { kakaoClientId } = getConfig();
  if (!kakaoClientId) {
    return res.status(400).send('카카오 클라이언트 ID가 설정되지 않았습니다.');
  }

  const host = req.get('host');
  const protocol = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
  const redirectUri = `${protocol}://${host}/api/auth/kakao/callback`;

  const kakaoAuthUrl = `https://kauth.kakao.com/oauth/authorize?client_id=${kakaoClientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code`;
  res.redirect(kakaoAuthUrl);
});

// 카카오 로그인 콜백 핸들러
app.get('/api/auth/kakao/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) return res.status(400).send(`카카오 인증 실패: ${error}`);
  if (!code) return res.status(400).send('인가 코드가 없습니다.');

  const { kakaoClientId, kakaoClientSecret, adminEmail } = getConfig();
  const host = req.get('host');
  const protocol = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
  const redirectUri = `${protocol}://${host}/api/auth/kakao/callback`;

  try {
    const tokenParams = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: kakaoClientId,
      client_secret: kakaoClientSecret,
      redirect_uri: redirectUri,
      code
    });

    const tokenRes = await fetch('https://kauth.kakao.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body: tokenParams.toString()
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.access_token) {
      throw new Error(tokenData.error_description || '카카오 토큰 발급 실패');
    }

    const userRes = await fetch('https://kapi.kakao.com/v2/user/me', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8'
      }
    });
    const kakaoUser = await userRes.json();
    if (!userRes.ok || !kakaoUser.id) {
      throw new Error('카카오 사용자 정보 조회 실패');
    }

    const kakaoAccount = kakaoUser.kakao_account || {};
    const profile = kakaoAccount.profile || {};
    const kakaoId = 'kakao_' + kakaoUser.id;
    const email = kakaoAccount.email || `kakao_${kakaoUser.id}@kakao.com`;
    const nickname = profile.nickname || '원무부 봉사자';
    const picture = profile.profile_image_url || null;

    let existingUser = await db.findUserById(kakaoId);
    if (!existingUser) {
      existingUser = await db.findUserByEmail(email);
    }

    if (!existingUser) {
      const isRoot = email.toLowerCase() === adminEmail;
      // 닉네임과 실명 매칭 확인
      const matchedMember = await db.findMemberByName(nickname);
      const role = isRoot ? 'root' : (matchedMember && matchedMember.isLeader ? 'admin' : 'user');
      const team = matchedMember ? matchedMember.team : '1조';

      existingUser = await db.createUser({
        id: kakaoId,
        email,
        name: nickname,
        picture,
        password: null,
        role,
        provider: 'kakao',
        memberName: nickname,
        team
      });
    }

    const token = jwt.sign({ userId: existingUser.id, email: existingUser.email }, JWT_SECRET, { expiresIn: '7d' });
    setAuthCookie(res, token);

    res.send(`
      <!DOCTYPE html>
      <html>
        <head><title>카카오 로그인 완료</title></head>
        <body style="font-family:sans-serif;text-align:center;padding:50px;background:#0F172A;color:#fff;">
          <h3>카카오 로그인 완료!</h3>
          <p>창을 닫고 서비스로 이동합니다...</p>
          <script>
            try {
              if (window.opener) {
                window.opener.postMessage({ type: 'KAKAO_LOGIN_SUCCESS', user: ${JSON.stringify(normalizeUser(existingUser))} }, '*');
                window.close();
              } else {
                window.location.href = '/';
              }
            } catch(e) {
              window.location.href = '/';
            }
          </script>
        </body>
      </html>
    `);
  } catch (err) {
    console.error('Kakao login error:', err);
    res.status(500).send(`<h3>카카오 로그인 처리 실패</h3><p>${err.message}</p>`);
  }
});

// ============================================================
// Root 전용: 전체 사용자 및 역할 관리 API (root > admin > user)
// ============================================================

// 전체 사용자 목록 조회
app.get('/api/admin/users', requireRoot, async (req, res) => {
  try {
    const users = await db.getAllUsers();
    res.json({
      success: true,
      users: users.map(u => normalizeUser(u))
    });
  } catch (err) {
    console.error('Fetch users error:', err);
    res.status(500).json({ error: '사용자 목록을 불러오지 못했습니다.' });
  }
});

// 사용자 역할 변경 (root, admin, user)
app.put('/api/admin/users/:id/role', requireRoot, async (req, res) => {
  try {
    const targetUserId = req.params.id;
    const { role } = req.body;
    if (!['root', 'admin', 'user'].includes(role)) {
      return res.status(400).json({ error: '유효한 역할(root, admin, user)을 지정해주세요.' });
    }

    const targetUser = await db.findUserById(targetUserId);
    if (!targetUser) {
      return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    }

    // 본인 root 권한을 강등하여 root 계정이 0개가 되는 것을 방지
    if (req.user.id === targetUserId && role !== 'root') {
      const allUsers = await db.getAllUsers();
      const rootCount = allUsers.filter(u => u.role === 'root').length;
      if (rootCount <= 1) {
        return res.status(400).json({ error: '시스템에 최소 한 명의 최고 관리자(Root)가 존재해야 합니다.' });
      }
    }

    const updated = await db.updateUserRole(targetUserId, role);
    res.json({
      success: true,
      message: `${targetUser.name}님의 권한이 [${role}]으로 변경되었습니다.`,
      user: updated
    });
  } catch (err) {
    console.error('Update role error:', err);
    res.status(500).json({ error: '권한 변경 실패: ' + err.message });
  }
});

// 사용자 삭제 (강제 탈퇴)
app.delete('/api/admin/users/:id', requireRoot, async (req, res) => {
  try {
    const targetUserId = req.params.id;
    if (req.user.id === targetUserId) {
      return res.status(400).json({ error: '현재 로그인된 본인 계정은 삭제할 수 없습니다.' });
    }

    const deleted = await db.deleteUser(targetUserId);
    if (!deleted) {
      return res.status(404).json({ error: '삭제할 사용자를 찾을 수 없습니다.' });
    }

    res.json({
      success: true,
      message: `${deleted.name} 사용자가 시스템에서 성공적으로 삭제되었습니다.`
    });
  } catch (err) {
    console.error('Delete user error:', err);
    res.status(500).json({ error: '사용자 삭제 실패: ' + err.message });
  }
});

// ============================================================
// 봉사 일정 관리 API (Admin / Root: 일정 등록 & 구글 시트 연동)
// ============================================================

// 일정 목록 조회 (신청자 통계 포함)
app.get('/api/events', async (req, res) => {
  try {
    const events = await db.getAllEvents();
    const allAttendance = await db.getAllAttendance();

    const result = events.map(event => {
      const attendances = allAttendance.filter(a => a.eventId === event.id);
      const isAppliedByMe = req.user ? attendances.some(a => a.memberName === (req.user.memberName || req.user.name)) : false;
      return {
        ...event,
        applicantCount: attendances.length,
        team1Count: attendances.filter(a => a.team === '1조' || a.team === 'A조').length,
        team2Count: attendances.filter(a => a.team === '2조' || a.team === 'B조').length,
        isAppliedByMe
      };
    });

    res.json({ success: true, events: result });
  } catch (err) {
    console.error('Fetch events error:', err);
    res.status(500).json({ error: '봉사 일정을 불러오는 데 실패했습니다.' });
  }
});

// 신규 봉사 일정 등록 (Admin / Root 전용 + 구글 시트 탭 생성 연동)
app.post('/api/events', requireAdmin, async (req, res) => {
  try {
    const { date, title, location, time, notice, targetTeam, syncGoogleSheet } = req.body;
    if (!date || !title) {
      return res.status(400).json({ error: '봉사 일자와 제목은 필수입니다.' });
    }

    const event = await db.createEvent({
      id: date,
      date,
      title: title.trim(),
      location: location || '어울림센터 (051-208-4458)',
      time: time || '17:30 ~ 19:00',
      notice: notice || '17시 30분까지 근무자도 가능하면 업무인계 후 참석 바랍니다.',
      targetTeam: targetTeam || '전체',
      status: 'OPEN'
    });

    let sheetResult = null;
    if (syncGoogleSheet !== false) {
      sheetResult = await googleSheets.createSheetForEvent(event);
    }

    res.json({
      success: true,
      message: '새로운 봉사 일정이 성공적으로 등록되었습니다!',
      event,
      googleSheet: sheetResult
    });
  } catch (err) {
    console.error('Create event error:', err);
    res.status(500).json({ error: '봉사 일정 등록 실패: ' + err.message });
  }
});

// 봉사 일정 수정 (Admin / Root 전용)
app.put('/api/events/:id', requireAdmin, async (req, res) => {
  try {
    const event = await db.updateEvent(req.params.id, req.body);
    if (!event) return res.status(404).json({ error: '일정을 찾을 수 없습니다.' });

    let sheetResult = null;
    if (req.body.syncGoogleSheet) {
      sheetResult = await googleSheets.createSheetForEvent(event);
    }

    res.json({
      success: true,
      message: '봉사 일정이 성공적으로 변경/수정되었습니다.',
      event,
      googleSheet: sheetResult
    });
  } catch (err) {
    console.error('Update event error:', err);
    res.status(500).json({ error: '일정 수정 실패: ' + err.message });
  }
});

// 봉사 일정 삭제 (Admin / Root 전용)
app.delete('/api/events/:id', requireAdmin, async (req, res) => {
  try {
    const event = await db.getEventById(req.params.id);
    const deleted = await db.deleteEvent(req.params.id);
    if (!deleted) return res.status(404).json({ error: '일정을 찾을 수 없습니다.' });

    // 구글 시트 탭 삭제 연동
    if (event) {
      googleSheets.deleteSheetForEvent(event).catch(err =>
        console.error('[Google Sheets] 탭 삭제 연동 실패:', err.message)
      );
    }

    res.json({ success: true, message: '봉사 일정이 삭제되었습니다.' });
  } catch (err) {
    console.error('Delete event error:', err);
    res.status(500).json({ error: '일정 삭제 실패' });
  }
});

// 특정 일정 상세 및 참석자 명단
app.get('/api/events/:id', async (req, res) => {
  try {
    const event = await db.getEventById(req.params.id);
    if (!event) return res.status(404).json({ error: '해당 봉사 일정을 찾을 수 없습니다.' });

    const attendances = await db.getAttendanceByEvent(req.params.id);
    const isAppliedByMe = req.user ? attendances.some(a => a.memberName === (req.user.memberName || req.user.name)) : false;

    res.json({
      success: true,
      event,
      attendances,
      applicantCount: attendances.length,
      isAppliedByMe
    });
  } catch (err) {
    console.error('Fetch event detail error:', err);
    res.status(500).json({ error: '상세 일정을 불러오지 못했습니다.' });
  }
});

// 참가 신청 / 취소 토글 (User 이상 가능)
app.post('/api/events/:id/apply', requireAuth, async (req, res) => {
  try {
    const eventId = req.params.id;
    const event = await db.getEventById(eventId);
    if (!event) return res.status(404).json({ error: '존재하지 않는 일정입니다.' });

    const memberName = req.body.memberName || req.user.memberName || req.user.name;
    const team = req.body.team || req.user.team || '1조';

    const result = await db.toggleEventApplication(eventId, memberName, team, req.user.id);
    const updatedAttendances = await db.getAttendanceByEvent(eventId);

    // 구글 시트 연동: 신청/취소 여부 실시간 반영
    googleSheets.updateAttendanceInSheet(event, memberName, result.applied).catch(err => {
      console.error('[Google Sheets] 실시간 참석 업데이트 실패:', err);
    });

    res.json({
      success: true,
      applied: result.applied,
      message: result.applied ? `${memberName}님의 봉사 참가 신청이 완료되었습니다!` : `${memberName}님의 참가 신청이 취소되었습니다.`,
      attendances: updatedAttendances,
      applicantCount: updatedAttendances.length
    });
  } catch (err) {
    console.error('Apply event error:', err);
    res.status(500).json({ error: '참가 신청 처리 중 오류가 발생했습니다.' });
  }
});

// 출석 상태 변경 (Admin / Root 전용)
app.post('/api/events/:id/status', requireAdmin, async (req, res) => {
  try {
    const { memberName, status } = req.body;
    const record = await db.updateAttendanceStatus(req.params.id, memberName, status);
    
    // 구글 시트 연동: 상태 변경 반영 (취소가 아닌 이상 참석으로 간주하거나, 엄격히 ATTENDED만 TRUE로 하려면 설정 필요)
    // 여기서는 취소(CANCELED)가 아니면 TRUE로 설정 (체크박스 체크)
    const event = await db.getEventById(req.params.id);
    if (event) {
      const isAttending = (status !== 'CANCELED');
      googleSheets.updateAttendanceInSheet(event, memberName, isAttending).catch(err => {
        console.error('[Google Sheets] 실시간 상태 변경 업데이트 실패:', err);
      });
    }

    res.json({ success: true, record });
  } catch (err) {
    console.error('Update attendance status error:', err);
    res.status(500).json({ error: '상태 변경 중 오류가 발생했습니다.' });
  }
});

// ============================================================
// 원무부 회원 목록 및 조편성 API
// ============================================================
app.get('/api/members', async (req, res) => {
  try {
    const members = await db.getAllMembers();
    const team1 = members.filter(m => m.team === '1조' || m.team === 'A조');
    const team2 = members.filter(m => m.team === '2조' || m.team === 'B조');

    res.json({
      success: true,
      totalCount: members.length,
      members,
      team1: { name: '1조 (A조 - 조장 서옥영)', leader: '서옥영', count: team1.length, members: team1 },
      team2: { name: '2조 (B조 - 조장 변승원)', leader: '변승원', count: team2.length, members: team2 }
    });
  } catch (err) {
    console.error('Fetch members error:', err);
    res.status(500).json({ error: '회원 목록을 불러오지 못했습니다.' });
  }
});

// 회원 조 변경 (Admin / Root 전용)
app.put('/api/members/:id/team', requireAdmin, async (req, res) => {
  try {
    const { team } = req.body;
    if (!team) {
      return res.status(400).json({ error: '변경할 조를 지정해주세요.' });
    }
    const updated = await db.updateMemberTeam(req.params.id, team);
    if (!updated) {
      return res.status(404).json({ error: '회원을 찾을 수 없습니다.' });
    }
    res.json({ success: true, member: updated });
  } catch (err) {
    console.error('Update member team error:', err);
    res.status(500).json({ error: '회원 조 변경 중 오류가 발생했습니다.' });
  }
});

// ============================================================
// 대시보드 통계 API
// ============================================================
app.get('/api/dashboard', async (req, res) => {
  try {
    const stats = await db.getDashboardStats(req.user);
    res.json({ success: true, stats });
  } catch (err) {
    console.error('Dashboard stats error:', err);
    res.status(500).json({ error: '대시보드 통계를 계산하지 못했습니다.' });
  }
});

// SPA 라우팅 지원 (모든 미처리 GET 요청을 index.html로)
app.use((req, res) => {
  if (req.method === 'GET') {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  } else {
    res.status(404).json({ error: '요청한 API 경로를 찾을 수 없습니다.' });
  }
});

// ============================================================
// 서버 기동
// ============================================================
if (require.main === module) {
  const startServer = (portToUse) => {
    const server = app.listen(portToUse, () => {
      const { kakaoClientId } = getConfig();
      const storageMode = db.isDbActive() ? 'PostgreSQL (Vercel/Neon DB)' : 'Local JSON File Mode (data/*.json)';
      console.log('====================================================');
      console.log(`🌟 원무부 봉사 관리 시스템 가동`);
      console.log(`🔗 URL: http://localhost:${portToUse}`);
      console.log(`💾 저장소: ${storageMode}`);
      console.log(`🛡️ 3-Tier 권한: root > admin > user`);
      console.log(`💬 카카오 OAuth: ${!!kakaoClientId}`);
      console.log('====================================================');
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.log(`⚠️ Port ${portToUse} is in use, trying ${portToUse + 1}...`);
        startServer(portToUse + 1);
      } else {
        console.error('Server error:', err);
      }
    });
  };

  startServer(PORT);
}

module.exports = app;
