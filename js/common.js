/*
 * 飲み会日程調整アプリ 共通ロジック
 * 画面に出す文字はすべて textContent で設定し、innerHTML は使わない（XSS 対策）。
 */
(function () {
  'use strict';

  // Apps Script の公開 URL（再デプロイで URL が変わったらここだけ書き換える）
  var API_URL = 'https://script.google.com/macros/s/AKfycbxIs4F0wetn3L23SdtmnBR47z-Hf_6Jyny7T0Xrr3aPAE-BanRcTAek65b7zHmpivrZ/exec';

  var MARKS = ['〇', '△', '×'];
  var WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
  var MEMBER_ID_PATTERN = /^[a-z0-9]+$/;
  var DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
  var POLL_INTERVAL_MS = 30000;

  // -------------------------------------------------------------------------
  // 共通

  /** API からデータを取得し、形をチェックして返す */
  function fetchData() {
    return fetch(API_URL, { cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) throw new Error('http ' + res.status);
        return res.json();
      })
      .then(function (data) {
        if (!data || data.ok !== true) throw new Error('api error');
        return sanitizeData(data);
      });
  }

  /** レスポンスから想定どおりの値だけを取り出す */
  function sanitizeData(data) {
    var members = (Array.isArray(data.members) ? data.members : []).filter(function (m) {
      return m && typeof m.id === 'string' && MEMBER_ID_PATTERN.test(m.id) &&
        typeof m.name === 'string' && m.name !== '';
    });
    var dates = (Array.isArray(data.dates) ? data.dates : []).filter(function (d) {
      return typeof d === 'string' && DATE_PATTERN.test(d);
    });
    var answers = (Array.isArray(data.answers) ? data.answers : []).filter(function (a) {
      return a && typeof a.memberId === 'string' && typeof a.date === 'string' &&
        MARKS.indexOf(a.mark) !== -1;
    });
    return { members: members, dates: dates, answers: answers };
  }

  /** "2026-11-14" → "11/14（土）" */
  function formatDate(iso) {
    var p = iso.split('-');
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    return (d.getMonth() + 1) + '/' + d.getDate() + '（' + WEEKDAYS[d.getDay()] + '）';
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // -------------------------------------------------------------------------
  // メインページ

  function initMain() {
    var linksEl = document.getElementById('member-links');
    var tbody = document.getElementById('summary-body');
    var emptyEl = document.getElementById('summary-empty');
    var errorEl = document.getElementById('error');
    var statusEl = document.getElementById('status');
    var sortButtons = document.querySelectorAll('[data-sort]');

    // 1回目のタップ時の向き
    var DEFAULT_DIR = { date: 'asc', o: 'desc', t: 'desc', x: 'desc' };
    var sort = { key: 'date', dir: 'asc' };
    var rows = [];
    var loaded = false;
    var loading = false;

    Array.prototype.forEach.call(sortButtons, function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.getAttribute('data-sort');
        if (sort.key === key) {
          sort.dir = sort.dir === 'asc' ? 'desc' : 'asc';
        } else {
          sort.key = key;
          sort.dir = DEFAULT_DIR[key];
        }
        renderTable();
      });
    });

    function load() {
      if (loading) return;
      loading = true;
      statusEl.textContent = '更新中…';
      fetchData()
        .then(function (data) {
          errorEl.hidden = true;
          renderLinks(data.members);
          rows = summarize(data.dates, data.answers);
          loaded = true;
          renderTable();
        })
        .catch(function () {
          errorEl.textContent = '通信に失敗しました。もう一度お試しください';
          errorEl.hidden = false;
        })
        .then(function () {
          loading = false;
          statusEl.textContent = '';
        });
    }

    function renderLinks(members) {
      linksEl.replaceChildren();
      members.forEach(function (m) {
        var li = el('li');
        var a = el('a', 'member-link', m.name);
        a.href = encodeURIComponent(m.id) + '.html';
        li.appendChild(a);
        linksEl.appendChild(li);
      });
    }

    /** 候補日ごとに 〇△× の人数を数え、〇最多の日に印をつける */
    function summarize(dates, answers) {
      var byDate = {};
      var result = dates.map(function (d) {
        var row = { date: d, o: 0, t: 0, x: 0, top: false };
        byDate[d] = row;
        return row;
      });
      answers.forEach(function (a) {
        var row = byDate[a.date];
        if (!row) return;
        if (a.mark === '〇') row.o++;
        else if (a.mark === '△') row.t++;
        else if (a.mark === '×') row.x++;
      });
      var maxO = result.reduce(function (max, r) { return Math.max(max, r.o); }, 0);
      if (maxO > 0) {
        result.forEach(function (r) { r.top = r.o === maxO; });
      }
      return result;
    }

    function renderTable() {
      var sorted = rows.slice().sort(function (a, b) {
        var sign = sort.dir === 'asc' ? 1 : -1;
        if (sort.key !== 'date' && a[sort.key] !== b[sort.key]) {
          return (a[sort.key] - b[sort.key]) * sign;
        }
        // 日付列のソート、または数が同じときは日付で比べる（同数は常に早い順）
        var cmp = a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
        return sort.key === 'date' ? cmp * sign : cmp;
      });

      tbody.replaceChildren();
      sorted.forEach(function (r) {
        var tr = el('tr', r.top ? 'is-top' : '');
        tr.appendChild(el('th', 'col-date', formatDate(r.date))).setAttribute('scope', 'row');
        tr.appendChild(el('td', 'col-count', String(r.o)));
        tr.appendChild(el('td', 'col-count', String(r.t)));
        tr.appendChild(el('td', 'col-count', String(r.x)));
        tbody.appendChild(tr);
      });
      emptyEl.hidden = !loaded || rows.length > 0;

      Array.prototype.forEach.call(sortButtons, function (btn) {
        var key = btn.getAttribute('data-sort');
        var active = key === sort.key;
        btn.querySelector('.sort-ind').textContent = active ? (sort.dir === 'asc' ? '▲' : '▼') : '';
        btn.parentNode.setAttribute('aria-sort',
          active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none');
      });
    }

    setInterval(function () {
      if (!document.hidden) load();
    }, POLL_INTERVAL_MS);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) load();
    });

    renderTable();
    load();
  }

  // -------------------------------------------------------------------------
  // 回答画面
  // メンバーID は <body data-member-id="…">、メンバーごとの文言は各 HTML に書いておく。

  var TOAST_MS = 3000;

  function initAnswer() {
    var memberId = document.body.getAttribute('data-member-id') || '';
    if (!MEMBER_ID_PATTERN.test(memberId)) return;

    var listEl = document.getElementById('answer-list');
    var submitBtn = document.getElementById('submit');
    var errorEl = document.getElementById('error');
    var statusEl = document.getElementById('status');
    var dialogEl = document.getElementById('confirm');
    var confirmSendBtn = document.getElementById('confirm-send');
    var confirmBackBtn = document.getElementById('confirm-back');
    var toastEl = document.getElementById('toast');

    var submitLabel = submitBtn.textContent;
    var dates = [];
    var selection = {};
    var busy = false;
    var toastTimer = null;

    function setBusy(on, statusText) {
      busy = on;
      statusEl.textContent = statusText || '';
      submitBtn.disabled = on || dates.length === 0;
      submitBtn.setAttribute('aria-busy', on ? 'true' : 'false');
      Array.prototype.forEach.call(listEl.querySelectorAll('.mark-btn'), function (b) {
        b.disabled = on;
      });
    }

    function showError() {
      errorEl.textContent = errorEl.getAttribute('data-message');
      errorEl.hidden = false;
      errorEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    function hideError() {
      errorEl.hidden = true;
    }

    function showToast() {
      toastEl.textContent = toastEl.getAttribute('data-message');
      toastEl.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { toastEl.hidden = true; }, TOAST_MS);
    }

    /** 自分の回答を読み込み直す（画面を開いたときと送信完了直後のみ） */
    function load() {
      setBusy(true, '読み込み中…');
      return fetchData()
        .then(function (data) {
          dates = data.dates.slice().sort();
          selection = {};
          data.answers.forEach(function (a) {
            if (a.memberId === memberId && dates.indexOf(a.date) !== -1) selection[a.date] = a.mark;
          });
          render();
          hideError();
        })
        .catch(showError)
        .then(function () { setBusy(false); });
    }

    function render() {
      listEl.replaceChildren();
      dates.forEach(function (d) {
        var li = el('li', 'answer-row');
        li.setAttribute('data-date', d);
        var label = el('span', 'answer-date', formatDate(d));
        label.id = 'date-' + d;
        var group = el('div', 'marks');
        group.setAttribute('role', 'group');
        group.setAttribute('aria-labelledby', label.id);
        MARKS.forEach(function (m) {
          var b = el('button', 'mark-btn', m);
          b.type = 'button';
          b.setAttribute('data-mark', m);
          group.appendChild(b);
        });
        li.appendChild(label);
        li.appendChild(group);
        listEl.appendChild(li);
        updateRow(li);
      });
    }

    function updateRow(li) {
      var current = selection[li.getAttribute('data-date')] || null;
      li.classList.toggle('is-unanswered', current === null);
      Array.prototype.forEach.call(li.querySelectorAll('.mark-btn'), function (b) {
        b.setAttribute('aria-pressed', b.getAttribute('data-mark') === current ? 'true' : 'false');
      });
    }

    listEl.addEventListener('click', function (e) {
      var btn = e.target.closest('.mark-btn');
      if (!btn || busy) return;
      var li = btn.closest('.answer-row');
      var date = li.getAttribute('data-date');
      var mark = btn.getAttribute('data-mark');
      // 選択中の記号をもう一度タップしたら未選択に戻す
      selection[date] = selection[date] === mark ? null : mark;
      updateRow(li);
    });

    submitBtn.addEventListener('click', function () {
      if (busy) return;
      var hasUnanswered = dates.some(function (d) { return !selection[d]; });
      if (hasUnanswered) openDialog();
      else send();
    });

    function openDialog() {
      dialogEl.hidden = false;
      document.body.classList.add('is-modal');
      confirmBackBtn.focus();
    }

    function closeDialog() {
      dialogEl.hidden = true;
      document.body.classList.remove('is-modal');
    }

    confirmSendBtn.addEventListener('click', function () {
      closeDialog();
      send();
    });

    confirmBackBtn.addEventListener('click', function () {
      closeDialog();
      var first = listEl.querySelector('.answer-row.is-unanswered');
      if (first) {
        first.scrollIntoView({ behavior: 'smooth', block: 'center' });
        first.querySelector('.mark-btn').focus({ preventScroll: true });
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !dialogEl.hidden) closeDialog();
    });

    function send() {
      var body = {
        memberId: memberId,
        answers: dates.map(function (d) { return { date: d, mark: selection[d] || null }; }),
      };
      setBusy(true);
      submitBtn.textContent = '送信中…';
      fetch(API_URL, {
        method: 'POST',
        // Apps Script は CORS のプリフライトに対応していないため text/plain で送る
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body),
      })
        .then(function (res) {
          if (!res.ok) throw new Error('http ' + res.status);
          return res.json();
        })
        .then(function (data) {
          if (!data || data.ok !== true) throw new Error('api error');
        })
        .then(function () {
          submitBtn.textContent = submitLabel;
          hideError();
          showToast();
          return load();
        }, function () {
          // 入力内容はそのまま残して再送信できるようにする
          submitBtn.textContent = submitLabel;
          setBusy(false);
          showError();
        });
    }

    setBusy(true);
    return load();
  }

  // -------------------------------------------------------------------------
  // カットイン演出（#cutin がある画面のみ）
  // 動き自体は CSS アニメーション。ここでは終了後に取り除き、回答画面を操作可能に戻すだけ。
  // 演出中は #cutin が画面全体を覆い、main は inert なのでタップや操作は受け付けない。

  var CUTIN_MS = 3000;

  function runCutin() {
    var cutin = document.getElementById('cutin');
    if (!cutin) return;
    setTimeout(function () {
      cutin.remove();
      document.querySelector('main').removeAttribute('inert');
      document.body.classList.remove('is-modal');
    }, CUTIN_MS);
  }

  // -------------------------------------------------------------------------

  document.addEventListener('DOMContentLoaded', function () {
    var page = document.body.getAttribute('data-page');
    if (page === 'main') {
      initMain();
    } else if (page === 'answer') {
      runCutin();
      // データの読み込みは演出と並行して進める
      initAnswer();
    }
  });
})();
