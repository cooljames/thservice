# [기획 및 구현 계획서] 원무부 어울림센터 봉사활동 관리 시스템 (thservice)

## 1. 프로젝트 개요
- **시스템 명칭**: 2026 원무부 어울림센터 봉사활동 관리 시스템 (`thservice`)
- **목적**: 
  - 격주 목요일마다 진행되는 어울림센터 봉사활동 일정 및 참가 이력 체계적 관리
  - 달력 UI를 통한 간편한 봉사 참가 신청 및 취소
  - 조별(1조 서옥영, 2조 변승원) 조편성 및 개인별 누적 참가 통계 대시보드 제공
  - `stockdash` 아키텍처를 계승한 완벽한 인증(이메일 + 카카오톡 소셜 로그인) 및 하이브리드 DB(로컬 JSON / Vercel Postgres) 지원

---

## 2. 참조 데이터 및 현황 분석

### 2.1 구글 스프레드시트 분석 결과
- **스프레드시트 명**: `2026 원무부 봉사(어울림센터)`
- **시설 정보**: 어울림센터 (연락처: `051-208-4458`)
- **운영 주기**: 매월 격주 목요일 (근무 종료 후 17:30 집결/참석)
- **2026년 봉사 일정**:
  - 상반기: 01/15, 01/29, 02/12, 02/26, 03/12, 03/26, 04/09, 04/23, 05/07, 05/28, 06/11, 06/25
  - 하반기: 07/09, 07/23, 08/06, 08/27, 09/10, 09/24 등 격주 목요일
- **조편성 (총 32~34명 등록 명단)**:
  - **1조 (A조)**: 조장 서옥영 / 강문기, 고금정, 권간중, 김진, 김희경, 박재정, 박재현, 배정한, 서옥영, 성주현, 윤유진, 정아름, 최서연, 조성희, 차미옥, 차혜린, 하연옥, 홍윤표 등
  - **2조 (B조)**: 조장 변승원 / 권혜경, 김도애, 김소영, 박성은, 백나래, 변승원, 신용식, 신유경, 온경하, 윤경미, 윤유진, 윤주은, 이상미, 이소현, 이승미, 제덕문, 조은영 등
- **통계 데이터**:
  - 누적 참가 상위자: 신용식(11회), 홍윤표(8회), 이상미(7회), 배정한(6회), 변승원(6회), 성주현(6회), 하연옥(6회), 정아름(6회) 등

### 2.2 인증 시스템 및 3단계 권한 체계 (root > admin > user)
- **인증 시스템**:
  - Express + JWT (쿠키 `auth_token` 기반 보안 세션)
  - Bcrypt 비밀번호 암호화
  - Kakao OAuth 2.0 팝업/콜백 로그인 연동
  - **원무부 등록 실명 검증 강제**:
    - 가입 시 `members` 등록 명단(32~34명: 서옥영, 변승원, 신용식, 홍윤표 등)의 실명만 가입 허용
    - 실명 입력 시 소속 조(1조/2조) 자동 지정 및 중복 가입 차단
  - **3-Tier 권한 체계**:
    - **`root` (최고 관리자)**: 모든 사용자 관리(권한 변경: root/admin/user, 강퇴/삭제), 모든 기능 제어
    - **`admin` (원무 관리자)**: 봉사 일정 등록/수정/삭제, 구글 시트 탭 생성, 출석 관리
    - **`user` (일반 회원)**: 봉사 신청/취소, 출석 현황 확인
  - `ADMIN_EMAIL` 환경변수를 통한 자동 root 권한 부여
- **데이터 저장소 (하이브리드 모드)**:
  - `DATABASE_URL` 또는 `POSTGRES_URL` 감지 시 Vercel Postgres / Neon DB 자동 연결
  - 미설정 시 로컬 `data/*.json` 파일 DB로 무중단 자동 fallback (로컬 환경에서 추가 설치 없이 즉시 실행 가능)
  - 서버리스 배포 호환 (`vercel.json`, `api/index.js`)
- **구글 스프레드시트 연동 (Google Sheets)**:
  - 봉사 일정 등록 시 구글 시트(`1XB0L7SIfLHicwXzU9trNHYQHZ1klfuh4-Xwp1PW17TM`)에 해당 일자(MM/DD) 탭 및 1조/2조 명단 템플릿 자동 생성

---

## 3. 핵심 기능 명세

### 3.1 캘린더 인터랙티브 뷰 (Calendar View)
- **월간 달력 UI**:
  - 사용자가 제공한 2026 달력 형태를 충실히 구현하면서 프리미엄 모던 테마 적용
  - 격주 목요일 봉사활동 일자 강조 배지(예: `1조 봉사`, `2조 봉사`, `전체`)
  - 각 날짜별 신청 현황(예: `신청 6명 / 정원 미정`) 뱃지 표시
- **날짜 클릭 인터랙션**:
  - 달력에서 목요일(또는 특정 날짜) 클릭 시 슬라이드 드로어 또는 모달 팝업 오픈
  - 해당 날짜의 상세 정보(시간: 17:30, 장소: 어울림센터 051-208-4458, 공지사항)
  - **원클릭 신청/취소**: 로그인한 사용자의 본인 참여 여부 즉시 변경
  - **조별 참석자 명단**: 1조/2조 참석 예정자 실시간 확인
  - **관리자 기능**: 관리자는 다른 회원의 참석 여부 대리 체크 및 명단 엑셀 다운로드 가능

### 3.2 봉사 이력 및 분석 대시보드 (Analytics Dashboard)
- **요약 KPI 카드**:
  - 누적 봉사 횟수 (총 N회 진행)
  - 총 참여 연인원 및 평균 참석률
  - 다음 예정 봉사활동 D-Day 카운트다운
  - 개인별 내 참가 횟수 및 출석률
- **비교 분석 및 시각화 차트**:
  - 1조 vs 2조 참여율 비교 게이지/도넛 차트
  - 월별 봉사 참여 인원 추이 바 차트
  - 명예의 전당 (최다 봉사자 TOP 10 랭킹)
- **봉사 히스토리 테이블**:
  - 과거 봉사활동 일자별 참석자 명단, 참석률, 사진 및 특이사항 열람

### 3.3 사용자 관리 및 조편성 (Members & Groups)
- 전체 원무부 회원 명단 조회 및 검색 (이름, 조, 부서/직책)
- 1조 / 2조 편성 확인 및 조장 연락처 안내
- 회원가입된 계정과 기존 스프레드시트 봉사자 명단 간 1:1 매칭 기능

### 3.4 로그인 / 회원가입 및 카카오 로그인
- 이메일/비밀번호 간편 가입 및 로그인 모달
- 카카오톡 1초 로그인 (기존 카카오 API 클라이언트 설정 계승)
- 비로그인 사용자: 달력 및 통계 조회 가능, 신청 클릭 시 로그인 팝업 유도
- 로그인 사용자: 원클릭 봉사 신청 및 내 봉사 기록 확인

---

## 4. 기술 스택 및 디렉터리 설계

### 4.1 기술 스택
- **런타임/서버**: Node.js, Express 5.x
- **인증**: JSON Web Token (`jsonwebtoken`), `bcryptjs`, `cookie-parser`
- **데이터베이스**: 
  - Production / Cloud: Vercel Postgres / Neon (`pg` Pool)
  - Local / Fallback: `data/users.json`, `data/events.json`, `data/attendance.json`
- **프론트엔드**: 바닐라 HTML5, 모던 CSS3 (Tailwind 의존 없는 독립형 프리미엄 디자인), Vanilla JavaScript (모듈형 컴포넌트)
- **외부 연동**: Kakao OAuth REST API

### 4.2 프로젝트 파일 구조 (`thservice`)
```
c:\Users\USER\Desktop\thservice\
├── .env.example            # 환경변수 템플릿 (DB URL, 카카오 키, JWT 비밀키)
├── .gitignore              # node_modules, .env 등 제외
├── package.json            # 프로젝트 의존성 설정
├── server.js               # Express 메인 서버 및 REST API 라우팅
├── db.js                   # Vercel Postgres / 로컬 JSON 하이브리드 데이터 계층
├── vercel.json             # Vercel 배포 설정
├── plan.md                 # 본 기획서 및 로드맵
├── api/
│   └── index.js            # Vercel Serverless 핸들러
├── data/
│   ├── users.json          # 사용자 및 관리자 계정 데이터 (기본 시드 포함)
│   ├── members.json        # 원무부 32명 회원 및 조편성 시드 데이터
│   ├── events.json         # 2026 격주 목요일 봉사 일정 목록
│   └── attendance.json     # 일자별 참석/신청 이력 데이터
├── public/
│   ├── index.html          # 메인 SPA 뷰 (달력 / 대시보드 / 명단 / 모달)
│   ├── css/
│   │   ├── reset.css       # 기본 리셋 스타일
│   │   ├── style.css       # 메인 모던 글래스모피즘 테마 및 레이아웃
│   │   └── calendar.css    # 달력 전용 컴포넌트 스타일
│   └── js/
│       ├── auth.js         # 인증 및 세션 관리 (stockdash 구조 반영)
│       ├── calendar.js     # 달력 렌더링, 월 이동, 신청 상호작용
│       ├── dashboard.js    # 통계 KPI 및 차트 렌더링
│       └── app.js          # 전역 초기화 및 탭 라우팅
```

---

## 5. 데이터베이스 스키마 설계 (PostgreSQL & JSON 공통)

1. **`users` (사용자 계정)**
   - `id`: UUID (Primary Key)
   - `email`: VARCHAR(255) (Unique)
   - `name`: VARCHAR(100) (실명)
   - `password`: TEXT (Bcrypt 해시, 소셜 로그인은 null)
   - `provider`: VARCHAR(50) ('email' | 'kakao')
   - `role`: VARCHAR(50) ('root' | 'admin' | 'user')
   - `member_id`: VARCHAR(100) (원무부 회원 명단 ID 연동)
   - `created_at`: TIMESTAMP

2. **`members` (원무부 회원 & 조편성)**
   - `id`: INT / UUID (Primary Key)
   - `name`: VARCHAR(100) (성명, 예: 서옥영, 변승원 등)
   - `team`: VARCHAR(10) ('A조' / '1조' | 'B조' / '2조')
   - `is_leader`: BOOLEAN (조장 여부)
   - `phone`: VARCHAR(50) (연락처, 필요시)
   - `note`: TEXT (비고: 17:30 근무 등)

3. **`volunteer_events` (봉사 일정)**
   - `id`: UUID / VARCHAR(50) (예: '2026-01-15')
   - `date`: DATE (2026-01-15 등 격주 목요일)
   - `title`: VARCHAR(255) ('원무부 어울림센터 봉사')
   - `team_in_charge`: VARCHAR(50) ('전체' | '1조' | '2조')
   - `location`: VARCHAR(255) ('어울림센터')
   - `memo`: TEXT ('17시 30분까지 근무자도 인계 후 참석')
   - `is_completed`: BOOLEAN

4. **`attendances` (참석 및 신청 이력)**
   - `id`: UUID (Primary Key)
   - `event_id`: VARCHAR(50) (외래키)
   - `member_name`: VARCHAR(100)
   - `user_id`: UUID (신청한 사용자 계정 ID, 옵션)
   - `team`: VARCHAR(10) ('1조' | '2조')
   - `status`: VARCHAR(20) ('APPLIED' | 'ATTENDED' | 'ABSENT')
   - `applied_at`: TIMESTAMP

---

## 6. 단계별 구현 절차 (사용자 승인 후 진행)

- [x] **1단계: 기획서 작성 및 승인 대기 (`plan.md`, `implementation_plan.md`)**
  - 요구사항 및 구글 시트 원본 분석 완료
  - 사용자 피드백 및 승인 대기
- [ ] **2단계: 프로젝트 기초 환경 구축**
  - `package.json`, `.env.example`, `.gitignore` 생성 및 의존성 설치
  - 2026년 구글 시트 데이터(32명 명단, 1/2조 조편성, 과거 참석 이력) 시드 JSON 생성
- [ ] **3단계: 하이브리드 DB 및 인증 백엔드 구현**
  - `db.js`: PostgreSQL (Vercel Postgres) 연결 및 로컬 JSON fallback 완벽 지원
  - `server.js`: 회원가입, 이메일 로그인, 카카오 OAuth, 일정 및 신청 API 구현
- [ ] **4단계: 모던 웹 프론트엔드 UI/UX 구현**
  - 메인 네비게이션 및 세션 헤더 (로그인 모달, 프로필 표시)
  - 사용자가 요청한 격주 목요일 캘린더 컴포넌트 (`calendar.js`)
  - 날짜 클릭 시 원클릭 참가 신청 및 참석자 명단 실시간 드로어 모달
  - 통계 KPI 및 그래프 대시보드 (`dashboard.js`)
  - 원무부 조편성 및 회원 목록 뷰
- [ ] **5단계: 로컬 테스트 및 Vercel 배포 검증**
  - 로컬 서버 실행 (`npm run dev`) 및 기능 검증
  - 카카오 로그인 및 DB 영속성 검증
  - 최종 가이드 및 산출물 보고서 작성

---
> 💡 **사용자 확인 요청**: 위 기획 및 구현 계획을 검토하신 후, 진행 승인을 주시면 즉시 2단계 코딩 작업에 착수하겠습니다.
