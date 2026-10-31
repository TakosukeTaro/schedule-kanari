/**
 * 飲み会日程調整アプリ API（Google Apps Script / コンテナバインド）
 *
 * シート構成（どのシートも1行目は見出し行、2行目からデータ）
 *   members : A=ID, B=表示名
 *   dates   : A=日付
 *   answers : A=メンバーID, B=日付, C=記号, D=更新日時（アプリが書き込む）
 */

const SHEET_MEMBERS = 'members';
const SHEET_DATES = 'dates';
const SHEET_ANSWERS = 'answers';
const TZ = 'Asia/Tokyo';
const MARKS = ['〇', '△', '×'];
const MEMBER_ID_PATTERN = /^[a-z0-9]+$/;
const MAX_BODY_LENGTH = 20000;
const LOCK_TIMEOUT_MS = 10000;

/** 取得：メンバー・候補日・全回答をまとめて返す */
function doGet() {
  try {
    return json_({
      ok: true,
      members: readMembers_(),
      dates: readDates_(),
      answers: readAnswers_(),
    });
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: 'server_error' });
  }
}

/** 送信：メンバー1人分の回答を全候補日まとめて上書き保存する */
function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(LOCK_TIMEOUT_MS);
  } catch (err) {
    return json_({ ok: false, error: 'busy' });
  }

  try {
    const body = parseBody_(e);
    if (!body) return json_({ ok: false, error: 'invalid_request' });

    const memberIds = readMembers_().map(function (m) { return m.id; });
    const dates = readDates_();
    const rows = validate_(body, memberIds, dates);
    if (!rows) return json_({ ok: false, error: 'invalid_request' });

    writeAnswers_(body.memberId, rows);
    return json_({ ok: true });
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: 'server_error' });
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// 入力チェック

/** リクエスト本文を JSON として読む。読めなければ null */
function parseBody_(e) {
  if (!e || !e.postData || typeof e.postData.contents !== 'string') return null;
  const text = e.postData.contents;
  if (text.length === 0 || text.length > MAX_BODY_LENGTH) return null;
  try {
    const body = JSON.parse(text);
    return isPlainObject_(body) ? body : null;
  } catch (err) {
    return null;
  }
}

/**
 * 送られてきた値をすべて検証する。
 * 正しければ保存する回答（未選択を除く）の配列、1つでもおかしければ null を返す。
 */
function validate_(body, memberIds, dates) {
  if (typeof body.memberId !== 'string') return null;
  if (memberIds.indexOf(body.memberId) === -1) return null;

  const answers = body.answers;
  if (!Array.isArray(answers)) return null;
  if (answers.length > dates.length) return null;

  const seen = {};
  const rows = [];
  for (let i = 0; i < answers.length; i++) {
    const a = answers[i];
    if (!isPlainObject_(a)) return null;
    if (typeof a.date !== 'string' || dates.indexOf(a.date) === -1) return null;
    if (seen[a.date]) return null;
    seen[a.date] = true;

    if (a.mark === null) continue;
    if (typeof a.mark !== 'string' || MARKS.indexOf(a.mark) === -1) return null;
    rows.push({ date: a.date, mark: a.mark });
  }
  return rows;
}

function isPlainObject_(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// ---------------------------------------------------------------------------
// シートの読み書き

function readMembers_() {
  const values = readDataRows_(SHEET_MEMBERS, 2);
  const members = [];
  const seen = {};
  values.forEach(function (r) {
    const id = String(r[0]).trim();
    const name = String(r[1]).trim();
    if (!MEMBER_ID_PATTERN.test(id) || !name || seen[id]) return;
    seen[id] = true;
    members.push({ id: id, name: name });
  });
  return members;
}

function readDates_() {
  const values = readDataRows_(SHEET_DATES, 1);
  const dates = [];
  values.forEach(function (r) {
    const d = normalizeDate_(r[0]);
    if (d && dates.indexOf(d) === -1) dates.push(d);
  });
  return dates;
}

function readAnswers_() {
  const values = readDataRows_(SHEET_ANSWERS, 4);
  const answers = [];
  values.forEach(function (r) {
    const memberId = String(r[0]).trim();
    const date = normalizeDate_(r[1]);
    const mark = String(r[2]).trim();
    if (!MEMBER_ID_PATTERN.test(memberId) || !date || MARKS.indexOf(mark) === -1) return;
    answers.push({ memberId: memberId, date: date, mark: mark });
  });
  return answers;
}

/**
 * answers シートからそのメンバーの行を削除し、新しい回答を追加する。
 * 途中で失敗してもデータが消えないよう、先に上書きしてから余った行を消す。
 */
function writeAnswers_(memberId, rows) {
  const sheet = getAnswersSheet_();
  const lastRow = sheet.getLastRow();
  const oldCount = Math.max(lastRow - 1, 0);
  const existing = oldCount > 0 ? sheet.getRange(2, 1, oldCount, 4).getValues() : [];

  const kept = [];
  existing.forEach(function (r) {
    const id = String(r[0]).trim();
    if (id === '' || id === memberId) return;
    kept.push([id, normalizeDate_(r[1]) || String(r[1]), String(r[2]), r[3]]);
  });

  const now = new Date();
  const added = rows.map(function (a) { return [memberId, a.date, a.mark, now]; });
  const all = kept.concat(added);

  if (all.length > 0) {
    // 日付の文字列が自動で日付型に変換されないよう、A〜C列は書式なしテキストにする
    sheet.getRange(2, 1, all.length, 3).setNumberFormat('@');
    sheet.getRange(2, 4, all.length, 1).setNumberFormat('yyyy/MM/dd HH:mm:ss');
    sheet.getRange(2, 1, all.length, 4).setValues(all);
  }
  if (oldCount > all.length) {
    sheet.getRange(2 + all.length, 1, oldCount - all.length, 4).clearContent();
  }
}

function getAnswersSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_ANSWERS);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_ANSWERS);
    sheet.getRange(1, 1, 1, 4).setValues([['メンバーID', '日付', '記号', '更新日時']]);
  }
  return sheet;
}

/** 指定シートの2行目以降を、先頭から numCols 列分読む */
function readDataRows_(sheetName, numCols) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) {
    if (sheetName === SHEET_ANSWERS) return [];
    throw new Error('sheet not found: ' + sheetName);
  }
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2, 1, lastRow - 1, numCols).getValues();
}

/** セルの値（日付型 or 文字列）を yyyy-MM-dd に変換する。変換できなければ null */
function normalizeDate_(v) {
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  }
  if (typeof v !== 'string') return null;
  const m = v.trim().match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);
  if (!m) return null;
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return m[1] + '-' + pad2_(month) + '-' + pad2_(day);
}

function pad2_(n) {
  return (n < 10 ? '0' : '') + n;
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------------------
// エディタでの動作確認用（デプロイ前に「実行」ボタンで試せる）

function testDoGet() {
  console.log(doGet().getContent());
}
