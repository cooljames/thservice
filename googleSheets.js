/* ============================================================
   thservice: Google 스프레드시트 연동 모듈
   스프레드시트: 2026 원무부 봉사(어울림센터)
   ID: 1XB0L7SIfLHicwXzU9trNHYQHZ1klfuh4-Xwp1PW17TM

   실제 시트 형식:
   - 탭 이름: MM/DD (예: 09/10)
   - Row 1   : No | 1조 서옥영 | 참석 여부 | 공지 | | 참석자 | | 사진
   - Row 2~17: 1조 조원 명단
   - Row 18  : No | 2조 변승원 | 참석 여부 (2조 헤더)
   - Row 19~ : 2조 조원 명단
   - 조 헤더 배경: #38761d (진녹색), 흰색 굵은 글자
   ============================================================ */

const db = require('./db');

// 기본 스프레드시트 정보
const DEFAULT_SPREADSHEET_ID = '1XB0L7SIfLHicwXzU9trNHYQHZ1klfuh4-Xwp1PW17TM';

/**
 * 날짜(YYYY-MM-DD)로부터 시트 탭 이름(MM/DD) 생성
 * 예: '2026-09-10' -> '09/10'
 */
function getSheetTabName(dateStr) {
  if (!dateStr) return '신규일정';
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    return `${parts[1]}/${parts[2]}`;
  }
  return dateStr;
}

// ============================================================
// 공통 헬퍼: Service Account 방식 Sheets 클라이언트 반환
// ============================================================
async function getSheetsClient() {
  const { google } = require('googleapis');
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  return google.sheets({ version: 'v4', auth });
}

// 템플릿 생성 및 폰트 서식 코드는 시트 복제 방식으로 변경되어 제거됨

/**
 * 일정 생성 시 구글 시트에 해당 일정 탭 생성 및 이전 시트 복사 적용
 *
 * 1) GOOGLE_APPS_SCRIPT_URL 설정 시: Apps Script POST 호출 (권장)
 * 2) GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY 설정 시: Sheets API v4 직접 호출 (이전 탭 복제)
 * 3) 둘 다 미설정 시: 로컬 시뮬레이션 (오류 없이 안전 동작)
 */
async function createSheetForEvent(event) {
  const tabName = getSheetTabName(event.date);
  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID || DEFAULT_SPREADSHEET_ID;
  const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;

  console.log(`[Google Sheets] 일정 등록: ${event.title} (${event.date}) -> 탭 "${tabName}" 생성 시도`);

  // 1. Google Apps Script Webhook 연동 방식
  if (scriptUrl) {
    try {
      const payload = {
        action: 'CREATE_EVENT_SHEET',
        spreadsheetId,
        sheetName: tabName,
        eventDate: event.date,
        eventTitle: event.title,
        notice: event.notice || '17시 30분까지 근무자도 가능하면 업무인계 후 참석 바랍니다.'
      };

      const res = await fetch(scriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const resData = await res.json().catch(() => ({}));
      console.log(`[Google Sheets] Apps Script 응답:`, resData);
      return {
        success: true,
        method: 'APPS_SCRIPT',
        tabName,
        message: `구글 시트에 "${tabName}" 탭이 성공적으로 생성되었습니다!`
      };
    } catch (err) {
      console.error(`[Google Sheets] Apps Script 호출 실패:`, err.message);
      return { success: false, method: 'APPS_SCRIPT', tabName, error: err.message };
    }
  }

  // ── 2. Service Account 방식 (마지막 탭 복제) ──
  if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
    try {
      const sheets = await getSheetsClient();

      const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
      
      // 기존 동명 탭 삭제 (중복 방지)
      const existing = spreadsheet.data.sheets.find(s => s.properties.title === tabName);
      if (existing) {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: { requests: [{ deleteSheet: { sheetId: existing.properties.sheetId } }] }
        });
      }

      // 복사할 대상 시트 찾기:
      // 삭제 대상(동명 탭)을 제외하고 탭 순서(인덱스)대로 정렬
      const sheetsList = spreadsheet.data.sheets
        .filter(s => s.properties.title !== tabName)
        .sort((a, b) => (a.properties.index || 0) - (b.properties.index || 0));

      if (sheetsList.length === 0) {
        throw new Error("복사할 이전 시트가 존재하지 않습니다.");
      }

      // 날짜 형태(MM/DD 등)를 가진 시트 중 가장 최근(마지막) 시트 우선 선택
      const dateSheets = sheetsList.filter(s => /^\d{1,2}\/\d{1,2}$/.test(s.properties.title));
      const sourceSheet = dateSheets.length > 0 ? dateSheets[dateSheets.length - 1] : sheetsList[sheetsList.length - 1];

      console.log(`[Google Sheets] 원본 탭 "${sourceSheet.properties.title}" 복제 -> 새 탭 "${tabName}" 생성`);

      // 신규 탭 추가 (이전 탭의 체크박스, 서식, 내용 전체를 그대로 복제)
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [
            {
              duplicateSheet: {
                sourceSheetId: sourceSheet.properties.sheetId,
                insertSheetIndex: sheetsList.length,
                newSheetName: tabName
              }
            }
          ]
        }
      });
      
      console.log(`[Google Sheets] "${sourceSheet.properties.title}" 탭의 체크박스 및 서식/내용이 "${tabName}"에 그대로 복사되었습니다.`);

      return {
        success: true,
        method: 'SERVICE_ACCOUNT',
        tabName,
        message: `구글 시트에 "${tabName}" 탭이 성공적으로 생성되었습니다!`
      };

    } catch (err) {
      console.error('[Google Sheets] Service Account 호출 에러:', err.message);
      return {
        success: false,
        method: 'SERVICE_ACCOUNT',
        tabName,
        error: err.message
      };
    }
  }

  // 3. 미설정 시 안전 안내 로그
  console.log(`[Google Sheets] 구글 연동 환경변수가 설정되지 않아 로컬 시뮬레이션으로 기록되었습니다.`);
  
  return {
    success: true,
    method: 'SIMULATION',
    tabName,
    message: `봉사 일정이 등록되었으며, 구글 시트 "${tabName}" 탭 연동 준비가 완료되었습니다.`
  };
}

/**
 * 일정 삭제 시 구글 시트에서 해당 탭 삭제
 *
 * 1) GOOGLE_APPS_SCRIPT_URL 설정 시: Apps Script POST (action: DELETE_EVENT_SHEET)
 * 2) GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY 설정 시: Sheets API v4 직접 삭제
 * 3) 둘 다 미설정 시: 시뮬레이션
 */
async function deleteSheetForEvent(event) {
  const tabName = getSheetTabName(event.date);
  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID || DEFAULT_SPREADSHEET_ID;
  const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;

  console.log(`[Google Sheets] 일정 삭제: ${event.title} (${event.date}) -> 탭 "${tabName}" 삭제 시도`);

  // ── 1. Google Apps Script 방식 ──
  if (scriptUrl) {
    try {
      const payload = { action: 'DELETE_EVENT_SHEET', spreadsheetId, sheetName: tabName };
      const res = await fetch(scriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      console.log(`[Google Sheets] Apps Script 삭제 응답:`, data);
      return { success: true, method: 'APPS_SCRIPT', tabName, data };
    } catch (err) {
      console.error(`[Google Sheets] Apps Script 삭제 실패:`, err.message);
      return { success: false, method: 'APPS_SCRIPT', tabName, error: err.message };
    }
  }

  // ── 2. Service Account 방식 ──
  if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
    try {
      const sheets = await getSheetsClient();
      const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
      const target = spreadsheet.data.sheets.find(s => s.properties.title === tabName);

      if (!target) {
        console.log(`[Google Sheets] 탭 "${tabName}"이 구글 시트에 없어 건너뜀니다.`);
        return { success: true, method: 'SERVICE_ACCOUNT', tabName, message: '탭이 존재하지 않아 건너뜀' };
      }

      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: [{ deleteSheet: { sheetId: target.properties.sheetId } }] }
      });

      console.log(`[Google Sheets] 탭 "${tabName}" 삭제 완료`);
      return { success: true, method: 'SERVICE_ACCOUNT', tabName, message: `"${tabName}" 탭이 삭제되었습니다.` };
    } catch (err) {
      console.error('[Google Sheets] Service Account 삭제 에러:', err.message);
      return { success: false, method: 'SERVICE_ACCOUNT', tabName, error: err.message };
    }
  }

  // ── 3. 미설정 시 시뮬레이션 ──
  console.log(`[Google Sheets] 연동 미설정 → 시뮬레이션: "${tabName}" 탭 삭제 예정`);
  return {
    success: true,
    method: 'SIMULATION',
    tabName,
    message: `시뮬레이션 모드: "${tabName}" 탭 삭제 완료`
  };
}

/**
 * 참석 여부 변경 시 구글 시트 해당 탭의 체크박스 상태 업데이트
 */
async function updateAttendanceInSheet(event, memberName, isAttending) {
  const tabName = getSheetTabName(event.date);
  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID || DEFAULT_SPREADSHEET_ID;
  const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;

  console.log(`[Google Sheets] 참석 상태 업데이트: ${memberName} -> ${isAttending ? '참석' : '취소'} (${tabName})`);

  // 1. Google Apps Script 방식
  if (scriptUrl) {
    try {
      const payload = { 
        action: 'UPDATE_ATTENDANCE', 
        spreadsheetId, 
        sheetName: tabName,
        memberName,
        isAttending
      };
      await fetch(scriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      return { success: true };
    } catch (err) {
      console.error(`[Google Sheets] Apps Script 참석 상태 업데이트 실패:`, err.message);
      // fallback to Service Account if both exist, otherwise return
    }
  }

  // 2. Service Account 방식
  if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) {
    try {
      const sheets = await getSheetsClient();
      
      // B열(이름) 데이터를 가져와서 해당 멤버의 행을 찾음
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${tabName}'!B:B`
      });
      
      const rows = res.data.values;
      if (!rows || rows.length === 0) return { success: false, message: '데이터가 없습니다.' };
      
      let targetRowIndex = -1;
      for (let i = 0; i < rows.length; i++) {
        if (rows[i] && rows[i][0] === memberName) {
          targetRowIndex = i; // 0-based index
          break;
        }
      }

      if (targetRowIndex === -1) {
        console.log(`[Google Sheets] "${memberName}"님을 "${tabName}" 시트에서 찾을 수 없습니다.`);
        return { success: false, message: '멤버를 찾을 수 없음' };
      }

      // C열(참석 여부) 업데이트
      const updateRange = `'${tabName}'!C${targetRowIndex + 1}`;
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: updateRange,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[ isAttending ? 'TRUE' : 'FALSE' ]] }
      });
      
      return { success: true };
    } catch (err) {
      console.error('[Google Sheets] Service Account 참석 상태 업데이트 실패:', err.message);
      return { success: false, error: err.message };
    }
  }

  return { success: true, method: 'SIMULATION' };
}

module.exports = {
  getSheetTabName,
  createSheetForEvent,
  deleteSheetForEvent,
  updateAttendanceInSheet
};
