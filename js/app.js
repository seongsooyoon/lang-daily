/* 매일 언어 — 화면·흐름 제어 */
(function (w, d) {
  'use strict';

  // 배포 스탬프를 자기 script 태그에서 읽어 학습자료·문서에도 붙인다.
  // 이게 없으면 새 회차를 올려도 휴대폰이 옛 data/*.json 을 계속 물고 있다.
  var VER = (function () {
    var el = d.querySelector('script[src*="app.js"]');
    var m = el && el.getAttribute('src').match(/[?&]v=([^&]+)/);
    return m ? m[1] : 'dev';
  })();

  var DATA = {};                 // { zh: {...}, en: {...}, ja: {...} }
  var LANGS = ['zh', 'en', 'ja'];   // 화면에 보일 순서
  var MOTIVE = null;             // 동기 문구 (심리학 근거 포함)
  var BOSTON = null;             // 보스턴 발음 진단 세트
  var BGUIDE = null;             // 보스턴 발음 구조 (조사 정리)
  var lang = 'zh';
  var day = 1;
  var step = 'brief';
  var talk = { i: 0, running: false, ok: 0, skip: 0, saved: false };

  var $ = function (s) { return d.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(d.querySelectorAll(s)); };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  var toastT = null;
  function toast(msg, ms) {
    var el = $('#toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toastT);
    toastT = setTimeout(function () { el.classList.add('hidden'); }, ms || 2600);
  }

  function today() {
    var n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate());
  }
  function parseDate(s) { var p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function daysBetween(a, b) { return Math.round((b - a) / 86400000); }

  function todayDay(c) {
    var n = daysBetween(parseDate(c.meta.start), today()) + 1;
    return Math.max(1, Math.min(c.meta.days, n));
  }
  function cfg() { return DATA[lang]; }
  function dayData(n) {
    var list = cfg().days;
    for (var i = 0; i < list.length; i++) if (list[i].d === (n == null ? day : n)) return list[i];
    return list[0];
  }

  /* ---------------- 렌더 ---------------- */

  // 원고가 있는 언어만 탭으로 보여 준다(일본어는 회차를 채우는 중)
  function syncLangTabs() {
    $$('.langtab').forEach(function (b) {
      var has = !!DATA[b.dataset.lang];
      b.classList.toggle('hidden', !has);
    });
    $$('.pick').forEach(function (b) {
      b.classList.toggle('hidden', !DATA[b.dataset.coverLang]);
    });
  }

  function renderHeader() {
    var c = cfg(), dd = dayData();
    d.body.dataset.lang = lang;                    // 언어에 따라 화면 색이 바뀐다(css/theme.css)
    d.documentElement.dataset.lang = lang;         // 바탕을 칠하는 것은 html 쪽
    var tc = d.querySelector('meta[name="theme-color"]');
    if (tc) tc.setAttribute('content', lang === 'zh' ? '#26221F' : '#1B3554');
    $('#day-n').textContent = 'Day ' + day;
    $('#day-total').textContent = '/ ' + c.meta.days;
    $('#day-phase').textContent = dd.phase;
    $('#day-theme').textContent = dd.theme;

    var pill = $('#day-dday'), dl = c.meta.deadline;
    if (dl) {
      var left = daysBetween(today(), parseDate(dl.date));
      pill.textContent = left > 0 ? (dl.label + ' D-' + left)
                       : left === 0 ? ('★ ' + dl.label + ' 당일 ★')
                       : (dl.label + ' 경과');
      pill.classList.remove('hidden');
    } else pill.classList.add('hidden');

    $('#progress-in').style.width = (w.Store.doneCount(lang) / c.meta.days * 100) + '%';
    syncLangTabs();
    $$('.langtab').forEach(function (b) { b.classList.toggle('on', b.dataset.lang === lang); });
    $$('.steps button').forEach(function (b) { b.classList.toggle('on', b.dataset.step === step); });
    $('.steps button[data-step="done"]').classList.toggle('did', w.Store.isDone(lang, day));
  }

  function renderBrief() {
    var dd = dayData(), c = cfg();
    $('#b-phase').textContent = dd.phase;
    var alt = $('#b-dday'), dl = c.meta.deadline;
    if (dl) {
      var left = daysBetween(today(), parseDate(dl.date));
      alt.textContent = left > 0 ? (dl.label + '까지 ' + left + '일') : dl.label;
      alt.classList.remove('hidden');
    } else alt.classList.add('hidden');
    $('#b-theme').textContent = dd.theme;
    $('#b-tip').textContent = dd.tip;

    var box = $('#b-accent');
    if (dd.accent) {
      $('#b-accent-title').textContent = ACCENT_TITLE[lang] || '발음 포인트';
      $('#b-accent-body').innerHTML = emph(dd.accent);
      box.classList.remove('hidden');
    } else box.classList.add('hidden');
  }

  var ACCENT_TITLE = {
    zh: '성조·발음 포인트',
    en: '보스턴 발음 포인트',
    ja: '고저 액센트 포인트'
  };

  // 원고에서 쓰는 **굵게** 만 살린다. 나머지는 글자 그대로 — 원고가 화면을 건드리지 못하게
  function emph(text) {
    return esc(text).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  }

  /* ---------------- 본문 조각 (눌러서 그 단어만 듣기) ---------------- */

  // 문장을 눌러서 들을 수 있는 조각으로 쪼갠다.
  // 중국어는 한 글자 = 한 음절이라 병음까지 짚어 줄 수 있고, 영어는 단어 단위로 나눈다.
  function mainHTML(text, phon, L) {
    var s = String(text == null ? '' : text);
    if (L === 'zh') {
      var syls = (w.Rec && w.Rec.pinyinSplit) ? w.Rec.pinyinSplit(phon) : [];
      var chars = s.match(/[㐀-鿿豈-﫿]/g) || [];
      var useSyl = syls.length === chars.length;      // 수가 맞을 때만 병음을 붙인다
      var k = 0, out = '';
      for (var i = 0; i < s.length; i++) {
        var ch = s[i];
        if (/[㐀-鿿豈-﫿]/.test(ch)) {
          var py = useSyl ? syls[k] : '';
          out += '<span class="tk" data-say="' + esc(ch) + '"' +
                 (py ? ' data-py="' + esc(py) + '"' : '') + '>' + esc(ch) + '</span>';
          k++;
        } else out += esc(ch);
      }
      return out;
    }
    if (L === 'ja') {
      // 일본어는 띄어쓰기가 없다. 글자 종류(한자·히라가나·가타카나·영숫자)가 바뀌는 곳에서 끊는다.
      // 형태소 분석이 아니라 근사치지만, 「研究所|の|職員|です」처럼 실제 단어 경계와 거의 맞고
      // 무엇보다 사전 없이 오프라인에서 돈다.
      var CLS = [
        /[一-鿿㐀-䶿]/,          // 한자
        /[぀-ゟ]/,                        // 히라가나
        /[゠-ヿｦ-ﾟ]/,          // 가타카나(장음 ー 포함)
        /[A-Za-z0-9]/                             // 영숫자
      ];
      function clsOf(ch) {
        for (var i = 0; i < CLS.length; i++) if (CLS[i].test(ch)) return i;
        return -1;                                 // 문장부호·공백 = 끊는 자리
      }
      var out = '', buf = '', cur = -1;
      function flush() {
        if (buf) out += '<span class="tk" data-say="' + esc(buf) + '">' + esc(buf) + '</span>';
        buf = '';
      }
      for (var i = 0; i < s.length; i++) {
        var ch = s[i], c = clsOf(ch);
        if (c < 0) { flush(); cur = -1; out += esc(ch); continue; }
        if (c !== cur) { flush(); cur = c; }
        buf += ch;
      }
      flush();
      return out;
    }
    return s.split(/(\s+)/).map(function (p) {
      if (!/[A-Za-z0-9]/.test(p)) return esc(p);
      var bare = p.replace(/[^A-Za-z0-9'\-]/g, '');
      return '<span class="tk" data-say="' + esc(bare) + '">' + esc(p) + '</span>';
    }).join('');
  }

  /* ---------------- ② 단어 ---------------- */

  function wordCard(wd, i) {
    var v = w.Store.getWord(lang, day, i);
    var done = v.reps >= w.Store.REPS;
    var h = '';
    h += '<div class="item word' + (done ? ' done' : '') + '" data-lang="' + lang + '" data-widx="' + i + '"' +
         ' data-text="' + esc(wd.text) + '" data-phon="' + esc(wd.phon) + '">';
    h += '<div class="wtop">';
    h += '<div><div class="main">' + esc(wd.text) + '</div>' +
         '<div class="phon">' + esc(wd.phon) + '</div>' +
         (wd.kr ? '<div class="kr">[' + esc(wd.kr) + ']</div>' : '') +
         '<div class="ko">' + esc(wd.ko) + '</div></div>';
    h += '<div class="dots" data-dots>' + dotsHTML(v.reps) + '</div>';
    h += '</div>';
    h += '<div class="row">';
    h += '<button class="playbtn" data-play="' + esc(wd.text) + '">▶ 듣기</button>';
    h += '<button class="playbtn slow" data-play="' + esc(wd.text) + '" data-slow="1">🐢 느리게</button>';
    h += '<button class="micbtn" data-wmic="' + i + '">🎙 따라 말하기</button>';
    if (v.best) h += '<span class="num" style="margin-left:auto">최고 ' + v.best + '점</span>';
    h += '</div>';
    h += '<div class="result"></div>';
    h += '</div>';
    return h;
  }

  function dotsHTML(reps) {
    var h = '';
    for (var i = 0; i < w.Store.REPS; i++) h += '<span class="dot' + (i < reps ? ' on' : '') + '"></span>';
    h += '<span class="dotnum">' + Math.min(reps, w.Store.REPS) + '/' + w.Store.REPS + '</span>';
    return h;
  }

  function renderWords() {
    var dd = dayData(), list = dd.words || [];
    if (!list.length) {
      $('#words-list').innerHTML = '<div class="card"><p class="tip">이 회차에는 단어 목록이 없습니다.</p></div>';
      return;
    }
    $('#words-list').innerHTML = list.map(wordCard).join('');
    if (!w.Speech.canListen()) {
      $('#words-hint').innerHTML = '⚠ 이 브라우저는 음성인식을 지원하지 않아 자동으로 세지 못합니다. ' +
        '말한 뒤 <b>✓ 한 번 말했음</b>을 눌러 직접 세십시오. 채점까지 원하시면 <b>크롬</b>으로 열어주십시오.';
      $$('#words-list [data-wmic]').forEach(function (b) { b.textContent = '✓ 한 번 말했음'; });
    }
    updateWordBar();
  }

  function updateWordBar() {
    var dd = dayData(), n = (dd.words || []).length;
    if (!n) { $('#wordbar-txt').textContent = ''; $('#wordbar-in').style.width = '0'; return; }
    var p = w.Store.wordProgress(lang, day, n);
    $('#wordbar-in').style.width = (p.reps / p.need * 100) + '%';
    $('#wordbar-txt').innerHTML = '반복 <b>' + p.reps + ' / ' + p.need + '</b>회 · ' +
      '완료한 단어 <b>' + p.words + ' / ' + p.of + '</b>개' +
      (p.reps >= p.need ? ' <span class="okmark">✔ 오늘 단어 다 채웠습니다</span>' : '');
  }

  function doWordMic(btn) {
    var itemEl = btn.closest('.item');
    var idx = parseInt(btn.dataset.wmic, 10);
    var text = itemEl.dataset.text;
    var res = itemEl.querySelector('.result');
    var c = cfg();

    // 인식이 안 되는 브라우저에서는 대표님이 직접 센다
    if (!w.Speech.canListen()) {
      var v0 = w.Store.addWordRep(lang, day, idx, null);
      gain('wordRep');
      if (v0.reps === w.Store.REPS) gain('wordDone');
      itemEl.querySelector('[data-dots]').innerHTML = dotsHTML(v0.reps);
      itemEl.classList.toggle('done', v0.reps >= w.Store.REPS);
      updateWordBar();
      return;
    }
    if (w.Speech.listening) { w.Speech.abort(); btn.classList.remove('rec'); btn.textContent = '🎙 따라 말하기'; return; }

    w.Speech.stop();
    btn.classList.add('rec'); btn.textContent = '● 듣는 중…';
    res.className = 'result';

    w.Speech.listen(c.meta.asr, function (alts) {
      btn.classList.remove('rec');
      var r = w.Speech.score(text, alts, lang);
      var pass = r.score >= 60;
      if (pass) {
        var v = w.Store.addWordRep(lang, day, idx, r.score);
        gain('wordRep');
        if (v.reps === w.Store.REPS) gain('wordDone');
        itemEl.querySelector('[data-dots]').innerHTML = dotsHTML(v.reps);
        itemEl.classList.toggle('done', v.reps >= w.Store.REPS);
        btn.textContent = v.reps >= w.Store.REPS ? '🎙 더 연습' : '🎙 다시 (' + v.reps + '/' + w.Store.REPS + ')';
        updateWordBar();
      } else {
        btn.textContent = '🎙 다시';
      }
      w.Report.recordMarks(lang, text, itemEl.dataset.phon, r.marks);
      var cls = r.score >= 80 ? 'good' : r.score >= 60 ? 'mid' : 'poor';
      res.className = 'result show ' + cls;
      res.innerHTML = '<div class="score">' + r.score + '점 ' +
        (pass ? '— 인정, 한 번 채웠습니다' : '— 아직입니다. 60점 넘어야 한 번으로 셉니다') + '</div>' +
        '<div>' + w.Speech.markup(text, r.marks, lang) + '</div>' +
        '<div class="heard">들린 대로: <b>' + esc(r.heard || '(없음)') + '</b></div>';
    }, function (code) {
      btn.classList.remove('rec'); btn.textContent = '🎙 다시';
      res.className = 'result show mid';
      res.innerHTML = '<div class="score">인식 실패</div><div class="heard">' +
        esc(w.Speech.errorText(code)) + '</div>';
    });
  }

  /* ---------------- ③④⑥ 문장 카드 ---------------- */

  function itemCard(it, i, opts) {
    opts = opts || {};
    var sc = opts.showScore ? w.Store.getScore(lang, opts.srcDay || day, i) : null;
    var h = '';
    h += '<div class="item" data-lang="' + lang + '" data-idx="' + i + '"' +
         ' data-text="' + esc(it.text) + '" data-phon="' + esc(it.phon) + '"' +
         (opts.srcDay ? ' data-srcday="' + opts.srcDay + '"' : '') + '>';
    h += '<div class="num">' + esc(opts.label || (i + 1)) + '</div>';
    h += '<div class="main">' + mainHTML(it.text, it.phon, lang) + '</div>';
    h += '<div class="phon">' + esc(it.phon) + '</div>';
    if (it.kr) h += '<div class="kr">[' + esc(it.kr) + ']</div>';
    h += '<div class="ko">' + esc(it.ko) + '</div>';
    h += '<div class="row">';
    h += '<button class="playbtn" data-play="' + esc(it.text) + '">▶ 듣기</button>';
    h += '<button class="playbtn slow" data-play="' + esc(it.text) + '" data-slow="1">🐢 느리게</button>';
    if (opts.mic) {
      h += '<button class="micbtn" data-mic="' + esc(it.text) + '">🎙 따라 말하기</button>';
      h += '<button class="recbtn" data-rec="1">🔴 녹음해 비교</button>';
      if (sc != null) h += '<span class="num" style="margin-left:auto">최고 ' + sc + '점</span>';
    }
    h += '</div>';
    if (opts.mic) h += '<div class="result"></div><div class="recbox"></div>';
    h += '</div>';
    return h;
  }

  function renderLearn() {
    var dd = dayData();
    $('#learn-list').innerHTML = dd.items.map(function (it, i) {
      return itemCard(it, i, { label: (i + 1) + ' / ' + dd.items.length });
    }).join('');
  }

  function renderSay() {
    var dd = dayData();
    $('#say-list').innerHTML = dd.items.map(function (it, i) {
      return itemCard(it, i, { mic: true, showScore: true, label: (i + 1) + ' / ' + dd.items.length });
    }).join('');
    if (!w.Speech.canListen()) {
      $('#say-hint').innerHTML = '⚠ 이 브라우저는 음성인식을 지원하지 않아 <b>점수가 나오지 않습니다</b>. ' +
        '🔴 녹음해 비교는 그대로 되니 귀로 확인하시고, 채점이 필요하면 <b>크롬</b>으로 열어주십시오.';
    }
    updateSayScore();
  }

  function updateSayScore() {
    var dd = dayData(), r = w.Store.dayAvg(lang, day, dd.items.length), box = $('#say-score');
    if (!r.cnt) { box.classList.remove('show'); return; }
    box.classList.add('show');
    box.innerHTML = '오늘 발음 평균 <b>' + r.avg + '</b>점 <span class="num">(' +
      r.cnt + '/' + dd.items.length + '문장)</span>';
  }

  function renderTalk() {
    var dd = dayData(), t = dd.dialogue;
    $('#talk-title').textContent = t ? t.title : '';
    $('#talk-scene').textContent = t ? t.scene : '';
    $('#talk-log').innerHTML = '';
    talk = { i: 0, running: false, ok: 0, skip: 0, saved: false };
    $('#talk-start').textContent = '대화 시작';
  }

  function renderReview() {
    var sp = w.Review.spaced(cfg(), day);
    var wk = w.Review.weak(cfg(), lang, day, 2);
    var h = '';
    if (!sp.length && !wk.length) {
      h = '<div class="card"><p class="tip">아직 복습할 예전 문장이 없습니다. 며칠 쌓이면 여기에 나타납니다.</p></div>';
    }
    sp.forEach(function (r) {
      h += itemCard(r.item, r.idx, { srcDay: r.srcDay, mic: true, showScore: true,
                                     label: 'D-' + r.off + ' · ' + r.srcDay + '회차' });
    });
    wk.forEach(function (r) {
      h += itemCard(r.item, r.idx, { srcDay: r.srcDay, mic: true, showScore: true,
                                     label: '약점 · ' + r.srcDay + '회차 (' + r.score + '점)' });
    });
    $('#review-list').innerHTML = h;
  }

  function renderDone() {
    var dd = dayData(), done = w.Store.getDone(lang, day);
    $('#mission-txt').textContent = dd.mission;
    $('#mission-chk').checked = !!(done && done.mission);

    var r = w.Store.dayAvg(lang, day, dd.items.length);
    var wp = w.Store.wordProgress(lang, day, (dd.words || []).length);
    var tk = w.Store.getTalk(lang, day);
    var h = '';
    h += '<div class="srow"><span>오늘 회차</span><b>Day ' + day + ' · ' + esc(dd.theme) + '</b></div>';
    h += '<div class="srow"><span>단어 반복</span><b>' + wp.reps + ' / ' + wp.need + '회</b></div>';
    h += '<div class="srow"><span>문장 발음</span><b>' +
         (r.cnt ? (r.avg + '점 (' + r.cnt + '/' + dd.items.length + ')') : '아직 없음') + '</b></div>';
    h += '<div class="srow"><span>대화 통과</span><b>' +
         (tk ? (tk.ok + ' / ' + tk.turns + '턴') : '아직 없음') + '</b></div>';
    h += '<div class="srow"><span>완료한 회차</span><b>' +
         w.Store.doneCount(lang) + ' / ' + cfg().meta.days + '</b></div>';
    h += '<div class="srow"><span>연속 학습</span><b>' + w.Store.streak() + '일</b></div>';
    $('#done-summary').innerHTML = h;
    $('#btn-complete').textContent = w.Store.isDone(lang, day) ? '✔ 완료됨 — 취소하려면 누르기' : '오늘 학습 완료';
  }

  /* ---------------- 평가 ---------------- */

  function bar(pct, cls) {
    return '<div class="mini"><div class="mini-in ' + (cls || '') + '" style="width:' +
           Math.max(0, Math.min(100, pct)) + '%"></div></div>';
  }

  function renderReport() {
    var c = cfg();
    var blocks = w.Report.allBlocks(lang, c);
    var s = w.Report.strengths(lang, c);
    var sounds = w.Report.sounds(lang);
    var h = '';

    if (!blocks.length && !s.total) {
      $('#report-body').innerHTML =
        '<div class="card"><h3>아직 평가할 자료가 없습니다</h3>' +
        '<p class="tip">단어와 문장을 마이크로 말해 보시면 그 결과가 여기에 쌓입니다. ' +
        '7회차마다 한 번씩 구간 성적이 확정되고, 구간이 늘수록 좋아지는지 나빠지는지가 보입니다.</p></div>';
      return;
    }

    // 현재 구간
    var cur = blocks[blocks.length - 1];
    if (cur) {
      h += '<div class="card">';
      h += '<div class="brief-head"><span class="tag">' + cur.from + '~' + cur.to + '회차</span>' +
           '<span class="tag alt">' + cur.doneN + '/' + Math.min(7, c.meta.days - cur.from + 1) + '회 완료</span></div>';
      if (cur.gradeInfo) {
        h += '<div class="gradebox"><div class="gl">' + cur.gradeInfo.grade + '</div>' +
             '<div><b>' + cur.gradeInfo.score + '점</b><br><span class="tip">' +
             esc(cur.gradeInfo.label) + '</span></div></div>';
      }
      h += '<div class="srow"><span>문장 발음</span><b>' +
           (cur.sentAvg != null ? cur.sentAvg + '점' : '–') + '</b></div>';
      h += '<div class="srow"><span>단어 발음</span><b>' +
           (cur.wordAvg != null ? cur.wordAvg + '점' : '–') + '</b></div>';
      h += '<div class="srow"><span>단어 반복</span><b>' + cur.reps + ' / ' + cur.need + '회</b></div>';
      if (lang === 'zh') {
        h += '<div class="srow"><span>성조 정확도</span><b>' +
             (cur.toneRate != null ? cur.toneRate + '% (' + cur.toneN + '음절)' : '–') + '</b></div>';
      }
      if (cur.talkInfo) {
        h += '<div class="srow"><span>대화 수준</span><b>' + cur.talkInfo.level + ' / 5</b></div>';
        h += '<p class="tip">' + esc(cur.talkInfo.label) + ' — 내 차례 ' + cur.talkRate + '% 통과</p>';
      }
      h += '</div>';
    }

    // 구간별 추이
    if (blocks.length >= 2) {
      var dS = w.Report.delta(blocks, 'sentAvg');
      h += '<div class="card"><h3>좋아지고 있는가</h3>';
      h += '<div class="trend">';
      blocks.forEach(function (b) {
        var v = b.gradeInfo ? b.gradeInfo.score : 0;
        h += '<div class="tcol"><div class="tbar" style="height:' + Math.max(4, v) + '%">' +
             '<span>' + (v || '') + '</span></div><div class="tlab">' + b.from + '~' + b.to + '</div></div>';
      });
      h += '</div>';
      if (dS != null) {
        h += '<p class="tip"><b>직전 구간 대비 ' + (dS > 0 ? '+' : '') + dS + '점.</b> ' +
             (dS > 3 ? '분명히 좋아지고 있습니다.' :
              dS >= 0 ? '유지되고 있습니다. 약점 소리를 집중해 보십시오.' :
              '떨어졌습니다. 아래 「안 되는 발음」을 다시 도십시오.') + '</p>';
      }
      h += '</div>';
    }

    // 소리별 약점
    if (sounds.length) {
      h += '<div class="card"><h3>소리별 정확도</h3>';
      h += '<p class="tip">표본 4회 이상인 것만 봅니다. 낮은 것부터입니다.</p>';
      sounds.forEach(function (x) {
        var cls = x.rate >= 85 ? 'ok' : x.rate >= 65 ? 'mid' : 'bad';
        h += '<div class="srow2"><span class="sk">' + esc(x.key) + '</span>' +
             bar(x.rate, cls) + '<b class="' + cls + '">' + x.rate + '%</b>' +
             '<span class="num">' + x.n + '회</span></div>';
      });
      h += '</div>';
    }

    // 잘되는 / 안 되는
    if (s.good.length) {
      h += '<div class="card"><h3>잘되는 발음</h3><div class="chips">';
      s.good.forEach(function (r) {
        h += '<span class="chip ok"><b>' + esc(r.text) + '</b> ' + r.score + '점</span>';
      });
      h += '</div></div>';
    }
    if (s.bad.length) {
      h += '<div class="card"><h3>안 되는 발음 — 여기부터 다시</h3><div class="list tight">';
      s.bad.forEach(function (r) {
        h += '<div class="item small" data-lang="' + lang + '">' +
             '<div class="num">' + r.kind + ' · ' + r.day + '회차 · ' + r.score + '점</div>' +
             '<div class="main">' + esc(r.text) + '</div>' +
             '<div class="phon">' + esc(r.phon) + '</div>' +
             '<div class="ko">' + esc(r.ko) + '</div>' +
             '<div class="row"><button class="playbtn" data-play="' + esc(r.text) + '">▶ 듣기</button>' +
             '<button class="playbtn" data-jump="' + r.day + '">' + r.day + '회차로 가기</button></div></div>';
      });
      h += '</div></div>';
    }

    h += '<div class="card"><p class="tip">평가는 기계 판정입니다. 원어민 심사가 아니라 ' +
         '<b>같은 잣대로 꾸준히 재서 추이를 보는 것</b>이 목적입니다. ' +
         '절대 점수보다 구간 사이의 변화를 보십시오.</p></div>';

    $('#report-body').innerHTML = h;
  }

  /* ---------------- 학습 의욕 ----------------
   * 기분 좋은 말이 아니라, 지속률을 실제로 올린다고 알려진 장치만 쓴다.
   * ①오늘의 한 마디(근거 표기) ②나의 이유(자율적 동기) ③언제·어디서(실행의도)
   * ④구간 축하(진전의 자각) ⑤막힐 때 읽는 글(자기자비·고원 대응)
   */

  function renderMotive() {
    var box = $('#motive');
    if (!MOTIVE) { box.innerHTML = ''; return; }
    var m = null, i;
    for (i = 0; i < MOTIVE.daily.length; i++) if (MOTIVE.daily[i].d === day) m = MOTIVE.daily[i];
    if (!m) { box.innerHTML = ''; return; }

    var h = '<div class="mv">';
    h += '<div class="mv-line">' + esc(m.line) + '</div>';
    h += '<div class="mv-why">' + esc(m.why) + '</div>';
    var why = w.Store.why(), plan = w.Store.plan();
    if (why || plan) {
      h += '<div class="mv-mine">';
      if (why) h += '<div><span>나의 이유</span> ' + esc(why) + '</div>';
      if (plan) h += '<div><span>공부할 자리</span> ' + esc(plan) + '</div>';
      h += '</div>';
    } else {
      h += '<button class="mv-set" id="btn-setwhy">왜 하는지·언제 할지 적어 두기 →</button>';
    }
    var ms = MOTIVE.milestones && MOTIVE.milestones[String(w.Store.doneCount(lang))];
    if (ms) h += '<div class="mv-ms">🏁 ' + esc(ms) + '</div>';
    h += '</div>';
    box.innerHTML = h;
  }

  function renderSituations() {
    var box = $('#situations');
    if (!MOTIVE) { box.innerHTML = ''; return; }
    var h = '<div class="card"><h3>막힐 때 읽는 글</h3>' +
            '<p class="tip">' + esc(MOTIVE.note) + '</p><div class="sitlist">';
    MOTIVE.situations.forEach(function (x) {
      h += '<details class="sit"><summary>' + esc(x.title) + '</summary>' +
           '<p>' + esc(x.body) + '</p><p class="mv-why">' + esc(x.why) + '</p></details>';
    });
    h += '</div></div>';
    box.innerHTML = h;
  }

  /* ---------------- 보스턴 발음 진단 (영어) ---------------- */

  function renderBoston() {
    var box = $('#boston-body');
    if (lang !== 'en' || !BOSTON) { box.innerHTML = ''; return; }
    var sc = w.Store.bostonScore('en');
    var h = '';
    if (BGUIDE) {
      h += '<div class="card bguide"><details><summary><b>' + esc(BGUIDE.title) + '</b> — 눌러서 펼치기</summary>';
      h += '<p class="tip">' + esc(BGUIDE.lead) + '</p>';
      BGUIDE.sections.forEach(function (x) {
        h += '<div class="gsec"><div class="gt"><span class="gn">' + esc(x.n) + '</span>' + esc(x.title) + '</div>';
        h += '<div class="gb">' + esc(x.body) + '</div>';
        h += '<div class="ge">' + esc(x.ex) + '</div>';
        h += '<div class="gc">확인: ' + esc(x.check) + '</div></div>';
      });
      h += '<div class="gsec"><div class="gt">' + esc(BGUIDE.practical.title) + '</div>' +
           '<div class="gb">' + esc(BGUIDE.practical.body) + '</div></div>';
      h += '<div class="src">출처: ' + esc(BGUIDE.sources.join(' · ')) + '<br>' +
           esc(BGUIDE.tooling) + '</div>';
      h += '</details></div>';
    }
    h += '<div class="card bost">';
    h += '<h3>' + esc(BOSTON.title) + '</h3>';
    h += '<p class="tip">' + esc(BOSTON.intro) + '</p>';
    h += '<div class="bscore">' + bostonScoreHTML(sc) + '</div>';
    h += '<p class="hint">※ <b>▶ 원어민</b> 버튼은 <b>표준 미국 발음</b>입니다(브라우저에 보스턴 음성이 없습니다). ' +
         '보스턴식은 아래 표기를 보고 흉내 내신 뒤 🔴 로 판정을 받으십시오.</p>';

    BOSTON.groups.forEach(function (g) {
      h += '<div class="bgroup"><h4>' + esc(g.name) + '</h4>';
      h += '<p class="bgoal">' + esc(g.goal) + '</p>';
      h += '<p class="tip">' + esc(g.how) + '</p>';
      g.items.forEach(function (it) {
        var prev = w.Store.getBoston('en', g.key, it.text);
        h += '<div class="bword" data-bkey="' + esc(g.key) + '" data-bword="' + esc(it.text) + '"' +
             ' data-bexpect="' + (g.expectRhotic === null ? 'null' : g.expectRhotic) + '"' +
             ' data-bmode="' + esc(g.mode) + '">';
        h += '<div class="bw-top"><b>' + esc(it.text) + '</b>' +
             '<span class="bw-say">보스턴 ' + esc(it.boston) + '  /  표준 ' + esc(it.us) + '</span></div>';
        h += '<div class="row">';
        h += '<button class="playbtn" data-play="' + esc(it.text) + '">▶ 원어민</button>';
        h += '<button class="recbtn" data-brec="1">' +
             (g.expectRhotic === null ? '🔴 녹음해 비교' : '🔴 녹음해 판정') + '</button>';
        if (prev && prev.ok != null) {
          h += '<span class="num vd ' + (prev.ok ? 'ok' : 'no') + '">' +
               (prev.ok ? '○ 보스턴식' : '✕ 표준식') + '</span>';
        }
        h += '</div><div class="bres"></div></div>';
      });
      h += '</div>';
    });
    h += '<p class="hint honest">' + esc(BOSTON.honest) + '</p>';
    h += '</div>';
    box.innerHTML = h;
  }

  function bostonScoreHTML(sc) {
    if (!sc.n) return '<span>아직 판정한 항목이 없습니다. 아래에서 한 단어씩 녹음해 보십시오.</span>';
    return '<b>' + sc.rate + '%</b><span>보스턴식으로 낸 항목 ' + sc.ok + ' / ' + sc.n + '</span>';
  }

  function doBostonRec(btn) {
    var el = btn.closest('.bword');
    var res = el.querySelector('.bres');
    var key = el.dataset.bkey, word = el.dataset.bword;
    var expect = el.dataset.bexpect === 'null' ? null : (el.dataset.bexpect === 'true');
    var mode = el.dataset.bmode;

    if (!w.Rec.supported()) {
      res.innerHTML = '<p class="hint">' + esc(w.Rec.errorText('unsupported')) + '</p>';
      return;
    }

    if (w.Rec.recording) {
      btn.classList.remove('rec'); btn.textContent = '분석 중…'; btn.disabled = true;
      w.Rec.stop(function (r) {
        btn.disabled = false;
        btn.textContent = expect === null ? '🔴 다시 녹음' : '🔴 다시 판정';
        if (!r) { res.innerHTML = '<p class="hint">녹음이 저장되지 않았습니다.</p>'; return; }
        res.innerHTML = '<p class="hint">소리를 살펴보는 중…</p>';
        w.Rhotic.analyze(r.blob).then(function (an) {
          showBoston(res, r, an, expect, mode, key, word);
        });
      });
      return;
    }

    w.Speech.stop(); w.Speech.abort();
    $$('.recbtn').forEach(function (b) {
      if (b !== btn) { b.classList.remove('rec'); if (b.textContent[0] === '■') b.textContent = '🔴 녹음해 판정'; }
    });
    res.innerHTML = '<p class="hint">마이크를 켜는 중…</p>';
    w.Rec.start(function () {
      btn.classList.add('rec'); btn.textContent = '■ 멈추고 확인';
      res.innerHTML = '<p class="hint">● <b>' + esc(word) + '</b> 한 마디만. 끝을 흐리지 말고 말한 뒤 멈추십시오.</p>';
    }, function (code) {
      btn.classList.remove('rec'); btn.textContent = '🔴 녹음해 판정';
      res.innerHTML = '<p class="hint">' + esc(w.Rec.errorText(code)) + '</p>';
    });
  }

  function showBoston(res, rec, an, expect, mode, key, word) {
    var h = '<div class="recrow">';
    h += '<button class="playbtn" data-play="' + esc(word) + '">▶ 원어민(표준)</button>';
    h += '<button class="playbtn" data-mine="1">▶ 내 발음</button>';
    h += '<button class="micbtn" data-ab="' + esc(word) + '">↔ 번갈아 듣기</button>';
    h += '</div>';
    h += '<canvas class="curve" style="height:84px"></canvas>';
    h += '<div class="brnote"></div>';
    res.innerHTML = h;
    res.dataset.url = rec.url;

    var cv = res.querySelector('canvas');
    var dpr = Math.min(2, w.devicePixelRatio || 1);
    var cw = Math.max(240, res.clientWidth || 300);
    cv.width = Math.round(cw * dpr); cv.height = Math.round(84 * dpr);
    cv._dpr = dpr; cv.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
    w.Rhotic.draw(cv, an, mode);

    var note = res.querySelector('.brnote');
    if (expect === null) {
      note.innerHTML = '<p class="hint">이 항목은 자동 판정하지 않습니다. ' +
        '<b>번갈아 듣기</b>로 표준 발음과 내 소리를 견주어 보십시오.</p>';
      return;
    }
    var j = w.Rhotic.judge(an, expect, mode);
    if (j.ok === null) {
      note.innerHTML = '<p class="hint">소리가 짧아 재지 못했습니다. 조금 길게, 마이크에 가까이 말씀해 보십시오.</p>';
      return;
    }
    w.Store.putBoston('en', key, word, j);
    if (j.ok) gain('boston');
    note.innerHTML =
      '<div class="bverdict ' + (j.ok ? 'ok' : 'no') + '">' +
      (expect
        ? (j.isRhotic ? '○ r 을 살렸습니다 — 연결 r 성공' : '✕ r 이 끊겼습니다 — 두 단어를 붙여 보십시오')
        : (j.isRhotic ? '✕ r 을 발음했습니다 — 미국 표준식입니다' : '○ r 을 흘렸습니다 — 보스턴식입니다')) +
      '</div>' +
      '<p class="hint">낮은 띠 / 높은 띠 에너지 비 <b>' + j.rise + '</b>배 ' +
      '(1.55배 이상이면 r 을 낸 것으로 봅니다) · 판정 신뢰도 ' + j.conf + '</p>';
    var sb = $('.bscore');
    if (sb) sb.innerHTML = bostonScoreHTML(w.Store.bostonScore('en'));
  }

  /* ---------------- 성취 (점수·레벨·배지·퀘스트·공유) ---------------- */

  function renderLvBar() {
    var L = w.Game.level(lang);
    $('#lvbar').innerHTML =
      '<span class="lv">Lv.' + L.lv + '</span>' +
      '<span class="lvt">' + esc(L.title) + '</span>' +
      '<span class="lvxp">' + L.xp.toLocaleString() + '점</span>' +
      '<span class="lvgauge"><i style="width:' + L.pct + '%"></i></span>';
  }

  // 점수를 주고, 화면 위 눈금과 오늘 몫을 함께 갱신한다
  function gain(key, times) {
    var got = w.Game.add(lang, key, times);
    if (got) { renderLvBar(); syncSoon(); }
    return got;
  }

  function renderTrophy() {
    var c = cfg();
    var L = w.Game.level(lang);
    var qs = w.Game.quests(lang, c, day);
    var bd = w.Game.check(lang, c);
    var streak = w.Store.streak();
    var today = w.Game.todayXP(lang), week = w.Game.weekXP(lang);
    var WEEK_GOAL = 700;
    var h = '';

    // 레벨 카드
    h += '<div class="card lvcard">';
    h += '<div class="lvtop"><div class="lvnum">' + L.lv + '</div>';
    h += '<div><b>' + esc(L.title) + '</b><div class="tip">' + L.xp.toLocaleString() + '점 누적' +
         (L.max ? ' · 최고 단계' : ' · 다음 단계까지 ' + L.toNext + '점') + '</div></div></div>';
    h += '<div class="mini big"><div class="mini-in" style="width:' + L.pct + '%"></div></div>';
    h += '<div class="lvfoot"><span>오늘 <b>' + today + '</b>점</span>' +
         '<span>연속 <b>' + streak + '</b>일</span>' +
         '<span>이번 주 <b>' + week + '</b>점</span></div>';
    h += '</div>';

    // 주간 목표 — 목표경사효과: 남은 거리를 늘 보여 준다
    var wp = Math.min(100, Math.round(week / WEEK_GOAL * 100));
    h += '<div class="card"><h3>이번 주 목표</h3>';
    h += '<div class="mini big"><div class="mini-in ' + (wp >= 100 ? 'ok' : '') + '" style="width:' + wp + '%"></div></div>';
    h += '<p class="tip">' + week + ' / ' + WEEK_GOAL + '점' +
         (wp >= 100 ? ' — 이번 주 목표를 넘겼습니다.' : ' — ' + (WEEK_GOAL - week) + '점 남았습니다.') + '</p></div>';

    // 오늘의 퀘스트
    h += '<div class="card"><h3>오늘의 퀘스트 <span class="sub">완료마다 +' + w.Game.XP.quest + '점</span></h3>';
    qs.forEach(function (q) {
      var pct = Math.round(q.cur / q.goal * 100);
      h += '<div class="quest' + (q.done ? ' done' : '') + '">';
      h += '<div class="qmark">' + (q.done ? '✔' : '○') + '</div>';
      h += '<div class="qbody"><b>' + esc(q.name) + '</b>' +
           '<div class="mini"><div class="mini-in ' + (q.done ? 'ok' : '') + '" style="width:' + pct + '%"></div></div>' +
           '<span class="tip">' + q.cur + ' / ' + q.goal + ' · ' + esc(q.hint) + '</span></div>';
      h += '</div>';
    });
    h += '</div>';

    // 배지
    h += '<div class="card"><h3>배지 <span class="sub">' +
         Object.keys(bd.owned).length + ' / ' + w.Game.BADGES.length + '</span></h3><div class="badges">';
    w.Game.BADGES.forEach(function (b) {
      var has = !!bd.owned[b.k];
      h += '<div class="badge' + (has ? ' has' : '') + '" title="' + esc(b.desc) + '">' +
           '<span class="bi">' + b.icon + '</span><span class="bn">' + esc(b.name) + '</span>' +
           '<span class="bd">' + esc(has ? bd.owned[b.k] + ' 획득' : b.desc) + '</span></div>';
    });
    h += '</div></div>';

    // 친구에게
    h += '<div class="card"><h3>친구와 함께</h3>';
    h += '<p class="tip">오늘 성적을 카카오톡·문자로 보낼 수 있습니다. ' +
         '함께 하는 사람이 있으면 이어 가는 비율이 올라갑니다(관계성 — Deci &amp; Ryan).</p>';
    h += '<pre class="sharebox" id="sharebox">' + esc(w.Game.shareText(lang, c, day)) + '</pre>';
    h += '<button class="go primary" id="btn-share">친구에게 보내기</button>';
    h += '<p class="hint">휴대폰에서는 공유창이 떠서 <b>카카오톡</b>을 고르실 수 있고, PC에서는 글이 복사됩니다.</p>';
    h += '</div>';

    h += '<div class="card"><p class="tip">점수는 상품이 아니라 <b>피드백</b>입니다. ' +
         '보상을 크게 걸면 좋아서 하던 일이 보상 때문에 하는 일로 바뀐다는 연구(과잉정당화 효과, Deci 1971)가 있어, ' +
         '무작위 보상이나 요란한 연출은 일부러 넣지 않았습니다.</p></div>';

    $('#trophy-body').innerHTML = h;
    renderRanking($('#trophy-body'));

    if (bd.fresh.length) {
      var b0 = w.Game.badgeOf(bd.fresh[0]);
      if (b0) toast(b0.icon + ' 배지 획득 — ' + b0.name, 3600);
    }
  }

  /* ---------------- 계정 (로그인·승인·랭킹) ---------------- */

  var syncTimer = null;

  function authOn() { return w.Auth && w.Auth.enabled; }

  function renderAccountBtn() {
    var b = $('#btn-account');
    b.classList.remove('hidden');
    if (!authOn()) { b.textContent = '👤'; b.title = '계정 (아직 혼자 쓰기)'; return; }
    if (w.Auth.user) {
      b.textContent = w.Auth.isApproved() ? '👤' : '⏳';
      b.title = w.Auth.displayName() + (w.Auth.isApproved() ? '' : ' (승인 대기)');
    } else {
      b.textContent = '👤';
      b.title = '로그인';
    }
  }

  function authFormHTML(mode) {
    var h = '';
    // 왜 안 되는지 스스로 보이도록 서버 상태를 맨 위에 둔다
    if (!authOn()) {
      h += '<div class="svst off">아직 <b>계정 서버가 연결되지 않았습니다</b>. ' +
           '☰ → 「여러 사람 쓰기」에서 먼저 연결해 주십시오. 연결 전에는 로그인이 되지 않습니다.</div>';
    } else {
      h += '<div class="svst ok">서버 연결됨' +
           (w.Auth.fromLocal ? ' <span class="svtag">이 기기에만 저장된 설정</span>' : '') + '</div>';
    }
    h += '<div class="authtabs">';
    h += '<button class="authtab' + (mode === 'in' ? ' on' : '') + '" data-authmode="in">로그인</button>';
    h += '<button class="authtab' + (mode === 'up' ? ' on' : '') + '" data-authmode="up">새로 가입</button>';
    h += '</div>';
    h += '<label class="fl">아이디</label>';
    h += '<input id="au-id" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="영문·숫자 (예: coqss1)">';
    if (mode === 'up') {
      h += '<label class="fl">이름 (화면에 보일 이름)</label>';
      h += '<input id="au-name" type="text" placeholder="예: 제임스 윤">';
    }
    h += '<label class="fl">비밀번호</label>';
    h += '<input id="au-pw" type="password" autocomplete="' + (mode === 'up' ? 'new-password' : 'current-password') + '" placeholder="6자 이상">';
    h += '<button class="go primary" id="au-go">' + (mode === 'up' ? '가입 신청' : '로그인') + '</button>';
    h += '<div id="au-msg" class="authmsg"></div>';
    if (mode === 'up') {
      h += '<p class="hint">가입하면 <b>관리자 승인</b>을 기다립니다. 승인 전에는 학습 화면이 열리지 않습니다.</p>';
    }
    h += '<p class="hint">비밀번호는 이 앱이 보관하지 않습니다. 계정 서버가 암호화해 저장하며 저희도 볼 수 없습니다.</p>';
    return h;
  }

  function renderAuth(mode) {
    var box = $('#auth-body');
    if (!authOn()) {
      $('#auth-title').textContent = '혼자 쓰기';
      box.innerHTML = '<p class="tip">지금은 계정 없이 이 기기에만 저장하는 방식으로 돌고 있습니다. ' +
        '여러 사람이 쓰시려면 계정 서버를 연결해야 합니다(SETUP.md 참고).</p>';
      return;
    }
    if (w.Auth.offline && !w.Auth.user) {
      $('#auth-title').textContent = '계정';
      box.innerHTML = '<p class="tip">계정 서버에 닿지 못했습니다. 인터넷이 연결되면 다시 시도해 주십시오. ' +
        '그동안에도 학습은 이 기기에서 그대로 됩니다.</p>';
      return;
    }

    if (!w.Auth.user) {
      $('#auth-title').textContent = '로그인';
      box.innerHTML = authFormHTML(mode || 'in');
      return;
    }

    // 로그인한 상태
    var p = w.Auth.profile || {};
    $('#auth-title').textContent = '내 계정';
    var h = '<div class="acct">';
    h += '<div class="acct-name">' + esc(w.Auth.displayName()) + '</div>';
    h += '<div class="acct-id">아이디 ' + esc(w.Auth.toId(p.email || '')) + '</div>';
    var st = p.status === 'approved' ? ['ok', '사용 승인됨']
           : p.status === 'blocked' ? ['no', '사용 중지됨']
           : ['wait', '승인 대기 중'];
    h += '<div class="acct-st ' + st[0] + '">' + st[1] + (w.Auth.isAdmin() ? ' · 관리자' : '') + '</div>';
    h += '</div>';

    if (p.status === 'pending') {
      h += '<p class="tip">관리자가 승인하면 바로 쓰실 수 있습니다. ' +
           '승인 전에도 이 기기에서 혼자 공부하는 것은 됩니다만, 점수가 서버에 올라가지 않아 순위표에 나오지 않습니다.</p>';
    }
    if (p.status === 'blocked') {
      h += '<p class="tip">관리자가 사용을 중지했습니다. 문의해 주십시오.</p>';
    }
    if (w.Auth.isAdmin()) {
      h += '<button class="go" id="btn-admin">승인 관리 열기</button>';
    }
    h += '<button class="go" id="btn-signout">로그아웃</button>';
    box.innerHTML = h;
  }

  function doAuth(mode) {
    var id = ($('#au-id').value || '').trim();
    var pw = $('#au-pw').value || '';
    var nameEl = $('#au-name');
    var msg = $('#au-msg');
    if (!id || !pw) { msg.className = 'authmsg no'; msg.textContent = '아이디와 비밀번호를 넣어 주십시오.'; return; }

    if (!authOn()) {
      msg.className = 'authmsg no';
      msg.textContent = '계정 서버가 아직 연결되지 않아 로그인할 수 없습니다. ☰ → 「여러 사람 쓰기」에서 연결해 주십시오.';
      return;
    }
    var btn = $('#au-go');
    btn.disabled = true; btn.textContent = '처리 중…';
    msg.className = 'authmsg'; msg.textContent = '';

    var p = (mode === 'up')
      ? w.Auth.signUp(id, pw, nameEl ? nameEl.value : '')
      : w.Auth.signIn(id, pw);

    p.then(function () {
      renderAccountBtn();
      renderAuth();
      afterLogin();
      toast(mode === 'up' ? '가입했습니다. 관리자 승인을 기다려 주십시오.' : '로그인했습니다.', 3600);
    }).catch(function (e) {
      btn.disabled = false; btn.textContent = (mode === 'up' ? '가입 신청' : '로그인');
      msg.className = 'authmsg no';
      var txt = w.Auth.errorText(e);
      // 가장 흔한 원인은 '아직 가입을 안 한 것'이다. 그걸 짚어 주지 않으면 계속 헤맨다.
      if (mode === 'in' && /맞지 않습니다/.test(txt)) {
        txt += ' 이 아이디로 가입한 적이 없다면 위의 ';
        msg.innerHTML = esc(txt) + '<b>「새로 가입」</b>' + esc(' 을 먼저 눌러 주십시오.');
        return;
      }
      msg.textContent = txt;
    });
  }

  /* ---------- 기기 사이 진도 맞추기 ----------
   * 로그인하면 ①서버 것을 내려받아 로컬과 **합치고** ②합친 결과를 다시 올린다.
   * 덮어쓰기가 아니라 합치기라서, 엣지에서 6회차·크롬에서 3회차를 했어도 둘 다 남는다.
   * 올리기까지 해야 늦게 로그인한 기기도 상대의 진도를 받아 갈 수 있다.
   */
  function afterLogin() {
    if (!authOn() || !w.Auth.user) return;
    var langs = LANGS.filter(function (L) { return DATA[L]; });
    var pulled = 0, changed = 0;
    langs.forEach(function (L) {
      w.Auth.pull(L).then(function (row) {
        if (row && row.data && w.Store.mergeLang(L, row.data)) changed++;
        pushNow(L);                       // 합친 결과를 올린다 — 서버가 항상 합집합이 되게
        if (++pulled === langs.length) {
          if (changed) { renderAll(); toast('다른 기기의 진도를 합쳤습니다.', 3600); }
          else toast('진도를 서버에 올렸습니다.', 2600);
        }
      });
    });
  }

  function pushNow(L) {
    if (!authOn() || !w.Auth.user || !w.Auth.isApproved()) return Promise.resolve(false);
    if (!DATA[L]) return Promise.resolve(false);
    return w.Auth.push(L, {
      data: w.Store.state[L],
      xp: w.Game.total(L),
      streak: w.Store.streak(),
      doneCount: w.Store.doneCount(L)
    });
  }

  // 진도가 바뀌면 잠시 뒤 한 번만 올린다(저장할 때마다 올리면 낭비다)
  function syncSoon(L) {
    if (!authOn() || !w.Auth.user || !w.Auth.isApproved()) return;
    var target = L || lang;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(function () { pushNow(target); }, 4000);
  }

  // 저장될 때마다 올리기를 건다 — 어느 화면에서 무엇을 하든 빠짐없이 올라간다
  w.Store.onSave = function () { syncSoon(); };

  // 창을 덮거나 닫을 때는 기다리지 않고 바로 올린다(4초를 못 채우고 나가는 경우)
  w.document.addEventListener('visibilitychange', function () {
    if (w.document.visibilityState === 'hidden') { clearTimeout(syncTimer); pushNow(lang); }
  });
  w.addEventListener('pagehide', function () { clearTimeout(syncTimer); pushNow(lang); });

  function renderAdmin() {
    var box = $('#admin-body');
    box.innerHTML = '<p class="hint">불러오는 중…</p>';
    w.Auth.listUsers().then(function (rows) {
      if (!rows.length) { box.innerHTML = '<p class="hint">아직 가입한 사람이 없습니다.</p>'; return; }
      var pend = rows.filter(function (r) { return r.status === 'pending'; });
      var rest = rows.filter(function (r) { return r.status !== 'pending'; });
      var h = '';
      h += '<p class="hint">승인해야 그 사람의 학습이 열리고 순위표에 들어옵니다.</p>';
      if (pend.length) {
        h += '<h4>승인 대기 ' + pend.length + '명</h4>';
        pend.forEach(function (r) { h += userRow(r); });
      }
      h += '<h4>전체 ' + rows.length + '명</h4>';
      rest.forEach(function (r) { h += userRow(r); });
      box.innerHTML = h;
    });
  }

  function userRow(r) {
    var st = r.status === 'approved' ? ['ok', '승인'] : r.status === 'blocked' ? ['no', '중지'] : ['wait', '대기'];
    var h = '<div class="urow">';
    h += '<div class="uinfo"><b>' + esc(r.name || '(이름 없음)') + '</b>' +
         '<span>' + esc(w.Auth.toId(r.email || '')) + ' · ' + String(r.created_at || '').slice(0, 10) + '</span></div>';
    h += '<span class="ust ' + st[0] + '">' + st[1] + (r.role === 'admin' ? '·관리자' : '') + '</span>';
    h += '<div class="uact">';
    if (r.status !== 'approved') h += '<button class="ghost" data-uapprove="' + esc(r.id) + '">승인</button>';
    if (r.status !== 'blocked') h += '<button class="ghost" data-ublock="' + esc(r.id) + '">중지</button>';
    h += '</div></div>';
    return h;
  }

  function renderRanking(into) {
    if (!authOn() || !w.Auth.isApproved()) return;
    w.Auth.ranking(lang, 20).then(function (rows) {
      if (!rows.length) return;
      var me = w.Auth.user && w.Auth.user.id;
      var h = '<div class="card"><h3>친구 순위 <span class="sub">' +
              (lang === 'zh' ? '중국어' : '영어') + '</span></h3>';
      h += '<p class="tip">승인된 사람들끼리만 보입니다. 학습 내용은 공유되지 않고 점수·연속일수만 나옵니다.</p>';
      rows.forEach(function (r, i) {
        h += '<div class="rrow' + (r.id === me ? ' me' : '') + '">' +
             '<span class="rno">' + (i + 1) + '</span>' +
             '<span class="rname">' + esc(r.name || '이름 없음') + (r.id === me ? ' (나)' : '') + '</span>' +
             '<span class="rxp">' + (r.xp || 0).toLocaleString() + '점</span>' +
             '<span class="rst">🔥' + (r.streak || 0) + '</span></div>';
      });
      h += '</div>';
      into.insertAdjacentHTML('beforeend', h);
    });
  }

  /* ---------------- 메인 표지 ----------------
   * 표지를 예쁜 그림으로만 두지 않고, 지금까지 쌓인 것을 숫자로 보여 준다.
   * 칭찬은 반드시 **실제 기록에 근거해서, 구체적으로** 한다.
   * 막연한 칭찬("잘하시네요")은 오히려 동기를 깎는다는 것이 연구 결과다(Dweck).
   * 능력이 아니라 한 일(횟수·연속·전략)을 짚는다.
   */

  var COVER_KEY = 'langdaily.cover.seen';

  function tally() {
    var t = { streak: w.Store.streak(), done: 0, reps: 0, said: 0, best: 0,
              xp: 0, badges: 0, boston: null, days: 0, talk: 0 };
    LANGS.forEach(function (L) {
      if (!DATA[L]) return;
      var st = w.Store.state[L];
      t.done += w.Store.doneCount(L);
      t.xp += w.Game.total(L);
      Object.keys(st.words).forEach(function (k) { t.reps += st.words[k].reps || 0; });
      Object.keys(st.scores).forEach(function (k) {
        t.said++;
        if (st.scores[k] > t.best) t.best = st.scores[k];
      });
      t.talk += Object.keys(st.talk).length;
      t.badges += Object.keys((st.game && st.game.badges) || {}).length;
      t.days += DATA[L].meta.days;
    });
    var b = w.Store.bostonScore('en');
    if (b.n) t.boston = b;
    return t;
  }

  // 지금 기록에서 가장 내세울 만한 것 하나를 골라 칭찬한다
  function praiseFor(t) {
    if (!t.done && !t.reps && !t.said) {
      return { big: '오늘 첫 걸음을 떼시면 됩니다.',
               small: '처음부터 잘하는 사람은 없습니다. 시작한 사람만 있습니다.' };
    }
    if (t.streak >= 30) {
      return { big: '한 달을 하루도 빠지지 않으셨습니다.',
               small: '이 정도면 의지가 아니라 습관입니다. 이제 안 하는 쪽이 어색해집니다.' };
    }
    if (t.streak >= 14) {
      return { big: t.streak + '일 연속입니다.',
               small: '지겨워지는 구간을 이미 지나셨습니다. 여기서부터는 관성이 밀어 줍니다.' };
    }
    if (t.streak >= 7) {
      return { big: '이레를 이어 오셨습니다.',
               small: '시작한 사람의 절반이 첫 주에 멈춥니다. 대표님은 남으셨습니다.' };
    }
    if (t.reps >= 300) {
      return { big: '단어를 ' + t.reps.toLocaleString() + '번 소리 내어 말하셨습니다.',
               small: '눈으로 읽은 것이 아니라 입으로 낸 횟수입니다. 그 숫자가 그대로 실력이 됩니다.' };
    }
    if (t.boston && t.boston.ok >= 5) {
      return { big: '보스턴 발음 ' + t.boston.ok + '개를 통과하셨습니다.',
               small: 'r을 흘리는 감각이 잡히고 있다는 뜻입니다. 귀가 먼저 열리고 입이 따라옵니다.' };
    }
    if (t.best >= 90) {
      return { big: '최고 ' + t.best + '점까지 내셨습니다.',
               small: '한 문장이라도 90점을 냈다면, 나머지 문장도 같은 방식으로 올라갑니다.' };
    }
    if (t.talk >= 5) {
      return { big: '대화를 ' + t.talk + '편 마치셨습니다.',
               small: '문장을 외운 것과 주고받아 본 것은 다릅니다. 실전에서 나오는 건 후자입니다.' };
    }
    if (t.done >= 3) {
      return { big: t.done + '회차를 마치셨습니다.',
               small: '꾸준함이 쌓이는 중입니다. 오늘 것만 하시면 됩니다.' };
    }
    return { big: '시작하셨습니다.',
             small: '오늘 단어 여섯 개만 채우셔도 하루 몫은 충분합니다.' };
  }

  function coverLine(L) {
    var c = DATA[L];
    if (!c) return '준비 중';
    var nd = todayDay(c);
    var doneToday = w.Store.isDone(L, nd);
    var dl = c.meta.deadline, tail = '';
    if (dl) {
      var left = daysBetween(today(), parseDate(dl.date));
      if (left > 0) tail = ' · ' + dl.label + ' D-' + left;
    }
    // 아직 안 쓴 회차가 있으면 '작성분 / 목표' 를 같이 보여 준다 — 진도가 멈춘 게 아니라는 표시
    var m = c.meta, head = m.stage ? m.stage + '차 ' : '';
    var total = (m.target && m.target > m.days) ? (m.days + '↑ / ' + m.target) : String(m.days);
    return head + 'Day ' + nd + ' / ' + total + (doneToday ? ' · 오늘 완료' : '') + tail;
  }

  function statBox(v, label) {
    return '<div class="cst"><b>' + v + '</b><span>' + label + '</span></div>';
  }

  function renderCover() {
    var t = tally();
    var p = praiseFor(t);

    $('#cv-praise').innerHTML =
      '<div class="pr-big">' + esc(p.big) + '</div>' +
      '<div class="pr-small">' + esc(p.small) + '</div>';

    var h = '';
    h += statBox(t.streak, '연속 학습일');
    h += statBox(t.done + ' / ' + t.days, '마친 회차');
    h += statBox(t.reps.toLocaleString(), '단어 말한 횟수');
    h += statBox(t.said.toLocaleString(), '말해 본 문장');
    if (t.boston) h += statBox(t.boston.rate + '%', '보스턴 발음');
    h += statBox(t.xp.toLocaleString(), '쌓은 점수');
    $('#cv-stats').innerHTML = h;

    // 받은 배지를 아이콘으로 늘어놓는다
    var bh = '';
    LANGS.forEach(function (L) {
      if (!DATA[L]) return;
      var g = (w.Store.state[L] && w.Store.state[L].game) || {};
      Object.keys(g.badges || {}).forEach(function (k) {
        var b = w.Game.badgeOf(k);
        if (b && bh.indexOf('>' + b.icon + '<') < 0) {
          bh += '<span class="cbg" title="' + esc(b.name) + '">' + b.icon + '</span>';
        }
      });
    });
    $('#cv-badges').innerHTML = bh ? ('<span class="cbg-l">받은 배지</span>' + bh) : '';

    LANGS.forEach(function (L) {
      var el = $('#cv-' + L);
      if (el) el.textContent = coverLine(L);
    });
  }

  function showCover() { renderCover(); $('#cover').classList.add('on'); }

  function hideCover() {
    $('#cover').classList.remove('on');
    try { w.localStorage.setItem(COVER_KEY, w.Store.todayStr()); } catch (e) {}
  }

  /* ---------------- 계정 서버 연결 ----------------
   * 서버 계정 가입은 대표님이 직접 하셔야 한다(가입·비밀번호는 내가 대신하지 않는다).
   * 그 대신, 가입 뒤 복사해 온 값 두 개를 여기에 붙여넣기만 하면 바로 켜지도록 만들었다.
   */

  function serverStateHTML() {
    var A = w.Auth;
    if (A.enabled && A.user) {
      return '<div class="svst ok">연결됨 · ' + esc(A.displayName()) +
             (A.isAdmin() ? ' (관리자)' : '') + '</div>';
    }
    if (A.enabled) {
      return '<div class="svst ok">서버 연결됨 — 👤 에서 가입·로그인하시면 됩니다' +
             (A.fromLocal ? ' <span class="svtag">이 기기에만 저장된 설정</span>' : '') + '</div>';
    }
    return '<div class="svst off">지금은 <b>혼자 쓰기</b>입니다. 링크를 나눠 주면 각자 자기 기기에서 쓸 수 있지만, ' +
           '<b>관리자 승인</b>과 <b>친구 순위</b>는 서버가 있어야 합니다.</div>';
  }

  function renderServer() {
    var A = w.Auth;
    var h = serverStateHTML();

    h += '<ol class="svsteps">';
    h += '<li><b>supabase.com</b> 에서 가입하고 프로젝트를 하나 만듭니다 <span>(무료 · 지역은 Seoul)</span>' +
         '<div class="row"><button class="ghost" id="sv-open">supabase.com 열기</button></div></li>';
    h += '<li><b>SQL Editor</b> 에 표 만들기 SQL 을 붙여넣고 Run 합니다' +
         '<div class="row"><button class="ghost" id="sv-copysql">SQL 복사</button>' +
         '<button class="ghost" id="sv-showsql">SQL 보기</button></div>' +
         '<textarea id="sv-sql" class="hidden" readonly spellcheck="false"></textarea></li>';
    h += '<li><b>Authentication → Providers → Email</b> 에서 <b>Confirm email 끄기</b>' +
         '<span>아이디만으로 로그인하려면 꼭 꺼야 합니다</span></li>';
    h += '<li><b>Project Settings → API</b> 의 두 값을 아래에 붙여넣습니다</li>';
    h += '</ol>';

    var cfg0 = (A.cfg || {});
    h += '<label class="fl">Project URL</label>';
    h += '<input id="sv-url" type="url" spellcheck="false" placeholder="https://xxxxxxxx.supabase.co" value="' +
         esc(cfg0.supabaseUrl || '') + '">';
    h += '<label class="fl">anon (공개) key</label>';
    h += '<input id="sv-key" type="text" spellcheck="false" placeholder="sb_publishable_... 또는 eyJ..." value="' +
         esc(cfg0.supabaseKey || '') + '">';
    h += '<div class="row"><button class="primary" id="sv-save">저장하고 연결</button>';
    if (A.fromLocal) h += '<button class="ghost" id="sv-clear">연결 해제</button>';
    h += '</div>';
    h += '<div class="row"><button class="ghost" id="sv-test">연결 확인</button></div>';
    h += '<div id="sv-msg" class="authmsg"></div>';
    h += '<p class="hint">anon 키는 <b>공개돼도 되는 키</b>입니다. 실제 접근 통제는 서버 쪽 보안 규칙(RLS)이 맡습니다. ' +
         '비밀번호는 여기에 넣지 마십시오 — 가입 화면에서 직접 입력하시면 됩니다.</p>';
    h += '<p class="hint">여기 저장한 설정은 <b>이 기기에만</b> 적용됩니다. 잘 되는 것을 확인하신 뒤 두 값을 알려 주시면 ' +
         '배포본(config.js)에 넣어 모든 사람에게 적용해 드리겠습니다.</p>';

    $('#server-box').innerHTML = h;
  }

  function loadSchemaSql() {
    return fetch('supabase/schema.sql?v=' + VER).then(function (r) {
      return r.ok ? r.text() : null;
    }).catch(function () { return null; });
  }

  function serverMsg(text, bad) {
    var el = $('#sv-msg');
    if (!el) return;
    el.className = 'authmsg' + (bad ? ' no' : ' ok');
    el.textContent = text;
  }

  function renderAll() {
    renderHeader(); renderLvBar(); renderMotive(); renderBrief(); renderWords(); renderLearn();
    renderSay(); renderTalk(); renderReview(); renderDone();
  }

  function go(s) {
    step = s;
    $$('.step').forEach(function (el) { el.classList.toggle('on', el.dataset.step === s); });
    $$('.steps button').forEach(function (b) { b.classList.toggle('on', b.dataset.step === s); });
    if (s === 'brief') renderMotive();
    if (s === 'done') renderDone();
    if (s === 'review') renderReview();
    if (s === 'say') updateSayScore();
    if (s === 'words') updateWordBar();
    if (s === 'trophy') renderTrophy();
    if (s === 'report') { renderBoston(); renderReport(); renderSituations(); }
    if (s !== 'talk') { talk.running = false; w.Speech.stop(); w.Speech.abort(); }
    w.Rec.cancel();
    w.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function setLang(L) {
    if (L === lang) return;
    w.Speech.stop(); w.Speech.abort(); w.Rec.cancel();
    lang = L; w.Store.lang(L);
    day = todayDay(cfg());
    renderAll(); go('brief');
  }

  function setDay(n) {
    var c = cfg();
    day = Math.max(1, Math.min(c.meta.days, n));
    w.Speech.stop(); w.Speech.abort(); w.Rec.cancel();
    renderAll();
  }

  /* ---------------- 듣기·말하기 ---------------- */

  function say(text, slow) {
    w.Speech.speak(text, cfg().meta.tts, (slow ? 0.55 : w.Store.rate()));
  }

  function warnVoice() {
    var c = cfg();
    if (!w.Speech.hasVoice(c.meta.tts)) {
      toast(c.meta.lang + ' 음성이 이 기기에 없어 발음이 어색할 수 있습니다.', 4200);
    }
  }

  function doMic(btn) {
    var c = cfg();
    var itemEl = btn.closest('.item');
    var res = itemEl.querySelector('.result');
    var text = btn.dataset.mic;
    var idx = parseInt(itemEl.dataset.idx, 10);
    var srcDay = itemEl.dataset.srcday ? parseInt(itemEl.dataset.srcday, 10) : day;

    if (!w.Speech.canListen()) {
      res.className = 'result show mid';
      res.innerHTML = '<div class="score">채점 불가</div><div class="heard">' +
        w.Speech.errorText('unsupported') + '</div>';
      return;
    }
    if (w.Speech.listening) { w.Speech.abort(); btn.classList.remove('rec'); btn.textContent = '🎙 따라 말하기'; return; }

    w.Speech.stop();
    btn.classList.add('rec'); btn.textContent = '● 듣는 중… (말씀하십시오)';
    res.className = 'result';

    w.Speech.listen(c.meta.asr, function (alts) {
      btn.classList.remove('rec'); btn.textContent = '🎙 다시 말하기';
      var r = w.Speech.score(text, alts, lang);
      var prevBest = w.Store.getScore(lang, srcDay, idx);
      var best = w.Store.putScore(lang, srcDay, idx, r.score);
      if (prevBest == null || r.score > prevBest) {
        var xk = w.Game.xpForScore(r.score);
        if (xk) gain(xk);
        if (srcDay !== day) gain('review');
      }
      w.Report.recordMarks(lang, text, itemEl.dataset.phon, r.marks);
      var cls = r.score >= 80 ? 'good' : r.score >= 55 ? 'mid' : 'poor';
      var word = r.score >= 90 ? '아주 좋습니다' : r.score >= 80 ? '통합니다'
               : r.score >= 55 ? '조금 더 또렷하게' : '다시 한 번';
      res.className = 'result show ' + cls;
      res.innerHTML =
        '<div class="score">' + r.score + '점 — ' + word + '</div>' +
        '<div>' + w.Speech.markup(text, r.marks, lang) + '</div>' +
        '<div class="heard">들린 대로: <b>' + esc(r.heard || '(없음)') + '</b>' +
        (best > r.score ? ' · 최고 ' + best + '점' : '') + '</div>';
      updateSayScore();
      renderHeader();
    }, function (code) {
      btn.classList.remove('rec'); btn.textContent = '🎙 따라 말하기';
      res.className = 'result show mid';
      res.innerHTML = '<div class="score">인식 실패</div><div class="heard">' +
        esc(w.Speech.errorText(code)) + '</div>';
    });
  }

  /* ---------------- 녹음해 비교 ---------------- */

  var player = null;

  function playMine(url, done) {
    if (player) { try { player.pause(); } catch (e) {} }
    player = new Audio(url);
    if (done) player.onended = done;
    player.play().catch(function () { toast('녹음을 재생하지 못했습니다.'); });
  }

  function doRec(btn) {
    var itemEl = btn.closest('.item');
    var box = itemEl.querySelector('.recbox');
    var text = itemEl.dataset.text;
    var phon = itemEl.dataset.phon;
    var idx = itemEl.dataset.idx != null ? parseInt(itemEl.dataset.idx, 10) : null;
    var srcDay = itemEl.dataset.srcday ? parseInt(itemEl.dataset.srcday, 10) : day;

    if (!w.Rec.supported()) {
      box.className = 'recbox show';
      box.innerHTML = '<p class="hint">' + esc(w.Rec.errorText('unsupported')) + '</p>';
      return;
    }

    if (w.Rec.recording) {
      btn.classList.remove('rec');
      btn.textContent = '분석 중…';
      btn.disabled = true;
      w.Rec.stop(function (r) {
        btn.disabled = false;
        btn.textContent = '🔴 다시 녹음';
        if (!r) { box.innerHTML = '<p class="hint">녹음이 저장되지 않았습니다.</p>'; return; }
        box.innerHTML = '<p class="hint">소리를 살펴보는 중…</p>';
        w.Rec.analyze(r.blob).then(function (an) { showRec(box, r, an, text, phon, srcDay, idx); });
      });
      return;
    }

    w.Speech.stop(); w.Speech.abort();
    if (player) { try { player.pause(); } catch (e) {} }
    $$('.recbtn').forEach(function (b) {
      if (b !== btn) { b.classList.remove('rec'); if (b.textContent[0] === '■') b.textContent = '🔴 녹음해 비교'; }
    });

    box.className = 'recbox show';
    box.innerHTML = '<p class="hint">마이크를 켜는 중…</p>';
    w.Rec.start(function () {
      btn.classList.add('rec');
      btn.textContent = '■ 멈추고 확인';
      box.innerHTML = '<p class="hint">● 녹음 중입니다. 문장을 또렷하게 말한 뒤 <b>■ 멈추고 확인</b>을 누르십시오.</p>';
    }, function (code) {
      btn.classList.remove('rec');
      btn.textContent = '🔴 녹음해 비교';
      box.innerHTML = '<p class="hint">' + esc(w.Rec.errorText(code)) + '</p>';
    });
  }

  function showRec(box, rec, an, text, phon, srcDay, idx) {
    var isZh = lang === 'zh';
    var expected = isZh ? w.Rec.tones(phon) : [];
    var judge = isZh && an ? w.Rec.judgeTones(an, expected) : null;
    var hgt = isZh ? 132 : 84;

    // 성조 결과를 평가에 쌓는다
    if (judge && judge.judged && idx != null) {
      w.Store.putTone(lang, srcDay, idx, judge.hit, judge.judged);
      w.Report.recordTones(lang, expected, judge);
      if (judge.judged >= 2 && judge.hit === judge.judged) gain('tonePerfect');
    }

    var h = '<div class="recrow">';
    h += '<button class="playbtn" data-play="' + esc(text) + '">▶ 원어민</button>';
    h += '<button class="playbtn" data-mine="1">▶ 내 발음</button>';
    h += '<button class="micbtn" data-ab="' + esc(text) + '">↔ 번갈아 듣기</button>';
    h += '</div>';
    h += '<canvas class="curve" style="height:' + hgt + 'px"></canvas>';
    h += '<div class="recnote"></div>';
    box.className = 'recbox show';
    box.innerHTML = h;
    box.dataset.url = rec.url;

    var cv = box.querySelector('canvas');
    var dpr = Math.min(2, w.devicePixelRatio || 1);
    var cw = Math.max(240, box.clientWidth || 300);
    cv.width = Math.round(cw * dpr);
    cv.height = Math.round(hgt * dpr);
    cv._dpr = dpr;
    cv.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);

    var note = box.querySelector('.recnote');
    if (isZh) {
      w.Rec.drawTones(cv, an, expected, judge);
      note.innerHTML = zhNote(expected, judge);
    } else {
      w.Rec.drawStress(cv, an);
      note.innerHTML =
        '<div class="legend"><span class="lg-mine"></span>내 목소리 세기</div>' +
        '<p class="hint">봉우리가 <b>' + esc(phon) + '</b> 의 대문자 부분에 오면 강세가 제대로 실린 것입니다. ' +
        '원어민과 번갈아 들으며 리듬이 같은지 확인하십시오.</p>';
    }
  }

  function zhNote(expected, judge) {
    var h = '<div class="legend"><span class="lg-mine"></span>내 음높이' +
            '<span class="lg-ref"></span>성조가 그려야 할 모양</div>';
    if (!judge || !judge.judged) {
      h += '<p class="hint">소리가 짧거나 작아 성조를 재지 못했습니다. 마이크에 가까이, 조금 길게 말씀해 보십시오.</p>';
      return h;
    }
    h += '<div class="tonerow">';
    expected.forEach(function (t, i) {
      var got = judge.got[i];
      var ok = (t === 0) ? null : (got === t);
      var cls = ok === null ? 'tn' : (ok ? 'tn ok' : 'tn no');
      h += '<span class="' + cls + '">' + (i + 1) + '음절 ' + esc(w.Rec.toneName(t)) +
           (ok === null ? '' : (ok ? ' ○' : ' ✕ → ' + esc(w.Rec.toneName(got) || '?'))) + '</span>';
    });
    h += '</div>';
    h += '<p class="hint"><b>성조 ' + judge.hit + ' / ' + judge.judged + ' 맞음.</b> ' +
         '검은 선(내 음높이)이 주황 점선(성조 모양)을 따라가면 맞은 것입니다. ' +
         '자동 판정은 참고용이니, 마지막 확인은 <b>번갈아 듣기</b>로 귀로 하십시오.</p>';
    return h;
  }

  /* ---------------- 대화 엔진 ---------------- */

  function turnHTML(t, i) {
    var me = t.who === 'me';
    var h = '<div class="turn ' + (me ? 'me' : 'them') + '" data-turn="' + i + '">';
    h += '<div class="t-main">' + mainHTML(t.text, t.phon, lang) + '</div>';
    if (t.phon) h += '<div class="t-phon">' + esc(t.phon) + (t.kr ? ' · ' + esc(t.kr) : '') + '</div>';
    h += '<div class="t-ko">' + esc(t.ko) + '</div>';
    h += '<div class="t-act">';
    h += '<button class="playbtn" data-play="' + esc(t.text) + '">▶ 듣기</button>';
    if (me) h += '<button class="micbtn" data-tmic="' + i + '">🎙 말하기</button>' +
                 '<button class="playbtn" data-tskip="' + i + '">건너뛰기</button>';
    h += '</div>';
    h += '<div class="t-res hidden"></div>';
    h += '</div>';
    return h;
  }

  function talkStep() {
    var dd = dayData(), t = dd.dialogue;
    if (!t || !talk.running) return;
    if (talk.i >= t.turns.length) {
      talk.running = false;
      $('#talk-start').textContent = '다시 하기';
      saveTalk();
      var end = d.createElement('div');
      end.className = 'card';
      var mine = t.turns.filter(function (x) { return x.who === 'me'; }).length;
      end.innerHTML = '<p class="tip">대화를 끝까지 마쳤습니다. 내 차례 ' + mine + '번 중 <b>' +
        talk.ok + '번을 스스로 통과</b>했습니다' + (talk.skip ? ' (건너뛰기 ' + talk.skip + '번)' : '') +
        '. 한 번 더 하시면 훨씬 빨리 입에 붙습니다.</p>';
      $('#talk-log').appendChild(end);
      end.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }
    var turn = t.turns[talk.i];
    var log = $('#talk-log');
    log.insertAdjacentHTML('beforeend', turnHTML(turn, talk.i));
    var el = log.lastElementChild;
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    if (turn.who === 'them') {
      w.Speech.speak(turn.text, cfg().meta.tts, w.Store.rate(), function () {
        setTimeout(function () { talk.i++; talkStep(); }, 450);
      });
    } else {
      el.classList.add('waiting');
    }
  }

  function saveTalk() {
    if (talk.saved) return;
    // 시작도 안 한 대화를 기록하면 '완주함'으로 잘못 잡힌다(퀘스트 오판정)
    if (talk.i === 0 && talk.ok === 0 && talk.skip === 0) return;
    var t = dayData().dialogue;
    if (!t) return;
    var mine = t.turns.filter(function (x) { return x.who === 'me'; }).length;
    w.Store.putTalk(lang, day, mine, talk.ok, talk.skip);
    if (talk.ok > 0) gain('talkDone');
    talk.saved = true;
  }

  function talkMic(i, btn) {
    var dd = dayData(), turn = dd.dialogue.turns[i];
    var el = $('.turn[data-turn="' + i + '"]');
    var res = el.querySelector('.t-res');
    var c = cfg();

    if (!w.Speech.canListen()) { advanceTurn(i, '채점 없이 진행합니다.', false); return; }
    if (w.Speech.listening) { w.Speech.abort(); btn.textContent = '🎙 말하기'; return; }

    w.Speech.stop();
    btn.textContent = '● 듣는 중…'; btn.classList.add('rec');
    res.classList.remove('hidden');
    res.textContent = '말씀하십시오…';

    w.Speech.listen(c.meta.asr, function (alts) {
      btn.classList.remove('rec');
      var r = w.Speech.score(turn.text, alts, lang);
      if (r.score >= 55) {
        res.innerHTML = '✔ ' + r.score + '점 — 통했습니다';
        btn.textContent = '🎙 말하기';
        talk.ok++;
        gain('talkTurn');
        advanceTurn(i, null, false);
      } else {
        res.innerHTML = '✕ ' + r.score + '점 · 들린 대로: <b>' + esc(r.heard || '(없음)') + '</b><br>' +
                        '다시 한 번 또렷하게 말씀해 주십시오.';
        btn.textContent = '🎙 다시';
      }
    }, function (code) {
      btn.classList.remove('rec'); btn.textContent = '🎙 다시';
      res.textContent = w.Speech.errorText(code);
    });
  }

  function advanceTurn(i, note, isSkip) {
    if (isSkip) talk.skip++;
    var el = $('.turn[data-turn="' + i + '"]');
    if (el) {
      el.classList.remove('waiting');
      var b = el.querySelector('[data-tmic]'); if (b) b.remove();
      var s = el.querySelector('[data-tskip]'); if (s) s.remove();
      if (note) { var r = el.querySelector('.t-res'); r.classList.remove('hidden'); r.textContent = note; }
    }
    if (talk.i === i) { talk.i++; setTimeout(talkStep, 300); }
  }

  /* ---------------- 회차 목록 ---------------- */

  function renderDayList(q) {
    var c = cfg(), todayN = todayDay(c), h = '';
    q = (q || '').trim().toLowerCase();
    var hit = 0;
    c.days.forEach(function (x) {
      var text = (x.d + ' ' + x.phase + ' ' + x.theme).toLowerCase();
      if (q && text.indexOf(q) < 0) return;
      hit++;
      var done = w.Store.isDone(lang, x.d);
      var r = w.Store.dayAvg(lang, x.d, (x.items || []).length);
      var cls = 'dayrow' + (done ? ' done' : '') + (x.d === day ? ' now' : '') +
                (x.d > todayN ? ' future' : '');
      h += '<button class="' + cls + '" data-cday="' + x.d + '">' +
           '<span class="dnum">' + x.d + '</span>' +
           '<span class="dtxt"><b>' + esc(x.theme) + '</b><span class="dph">' + esc(x.phase) + '</span></span>' +
           '<span class="dmark">' + (done ? '✔' : (r.avg != null ? r.avg + '점' : '')) + '</span>' +
           '</button>';
    });
    if (!hit) h = '<p class="hint">찾는 회차가 없습니다.</p>';
    $('#daylist').innerHTML = h;
  }

  function openDaySheet() {
    $('#day-search').value = '';
    renderDayList('');
    $('#daysheet').classList.remove('hidden');
    var now = $('#daylist .dayrow.now');
    if (now) now.scrollIntoView({ block: 'center' });
  }

  /* ---------------- 설정 시트 ---------------- */

  function installHTML() {
    var ua = navigator.userAgent || '';
    var ios = /iPad|iPhone|iPod/.test(ua);
    var standalone = w.matchMedia('(display-mode: standalone)').matches || w.navigator.standalone;
    if (standalone) {
      return '<p class="hint">✔ 이미 앱으로 설치돼 실행 중입니다.</p>';
    }
    if (ios) {
      return '<ol class="steps-list"><li>사파리 아래쪽 <b>공유 버튼(⬆)</b>을 누릅니다</li>' +
             '<li><b>홈 화면에 추가</b>를 선택합니다</li>' +
             '<li>이름을 <b>매일언어</b>로 두고 <b>추가</b>를 누릅니다</li></ol>' +
             '<p class="hint">홈 화면 아이콘으로 열면 주소창 없이 앱처럼 뜹니다. ' +
             '※ 아이폰은 사파리에서 추가해야 합니다.</p>';
    }
    return '<button id="btn-install" class="primary wide">홈 화면에 앱으로 추가</button>' +
           '<p class="hint">버튼이 눌리지 않으면 크롬 오른쪽 위 <b>⋮ → 홈 화면에 추가</b>를 눌러 주십시오.</p>';
  }

  function renderSheet() {
    var c = cfg();
    var doneN = w.Store.doneCount(lang);
    var allScores = Object.keys(w.Store.state[lang].scores);
    var avg = allScores.length
      ? Math.round(allScores.reduce(function (a, k) { return a + w.Store.state[lang].scores[k]; }, 0) / allScores.length)
      : null;

    $('#statgrid').innerHTML =
      '<div class="stat"><b>' + doneN + '</b><span>완료 회차</span></div>' +
      '<div class="stat"><b>' + w.Store.streak() + '</b><span>연속 학습일</span></div>' +
      '<div class="stat"><b>' + (avg == null ? '–' : avg) + '</b><span>발음 평균</span></div>';
    renderServer();
    $('#install-box').innerHTML = installHTML();
    $('#in-why').value = w.Store.why();
    $('#in-plan').value = w.Store.plan();
    $('#rate-val').textContent = '현재 속도 ' + w.Store.rate().toFixed(2) + '배 (느릴수록 또렷)';
    $('#rate').value = w.Store.rate();
  }

  function openSheet() { renderSheet(); $('#sheet').classList.remove('hidden'); }
  function closeSheet(id) {
    $('#' + id).classList.add('hidden');
    if (id === 'sheet') { $('#io-box').classList.add('hidden'); renderMotive(); }
  }

  /* ---------------- 이벤트 ---------------- */

  var deferredPrompt = null;

  function wire() {
    d.addEventListener('click', function (ev) {
      // 본문 조각을 누르면 그 한 단어(글자)만 천천히 읽어 준다
      var tk = ev.target.closest('.tk');
      if (tk) {
        w.Speech.stop();
        w.Speech.speak(tk.dataset.say, cfg().meta.tts, 0.6);
        tk.classList.add('hit');
        setTimeout(function () { tk.classList.remove('hit'); }, 700);
        toast(tk.dataset.say + (tk.dataset.py ? '  ·  ' + tk.dataset.py : ''), 1800);
        return;
      }
      var t = ev.target.closest('button');
      if (!t) return;

      if (t.dataset.play != null) { warnVoice(); say(t.dataset.play, t.dataset.slow === '1'); return; }
      if (t.dataset.mic != null) { doMic(t); return; }
      if (t.dataset.wmic != null) { doWordMic(t); return; }
      if (t.dataset.rec != null) { doRec(t); return; }
      if (t.dataset.brec != null) { doBostonRec(t); return; }
      if (t.dataset.tmic != null) { talkMic(parseInt(t.dataset.tmic, 10), t); return; }
      if (t.dataset.tskip != null) { advanceTurn(parseInt(t.dataset.tskip, 10), '건너뛰었습니다.', true); return; }
      if (t.dataset.jump != null) { setDay(parseInt(t.dataset.jump, 10)); go('say'); return; }
      if (t.dataset.mine != null) {
        w.Speech.stop();
        playMine((t.closest('.recbox') || t.closest('.bres')).dataset.url);
        return;
      }
      if (t.dataset.ab != null) {
        var url = (t.closest('.recbox') || t.closest('.bres')).dataset.url;
        t.textContent = '▶ 원어민…';
        w.Speech.speak(t.dataset.ab, cfg().meta.tts, w.Store.rate(), function () {
          t.textContent = '▶ 내 발음…';
          setTimeout(function () { playMine(url, function () { t.textContent = '↔ 번갈아 듣기'; }); }, 350);
        });
        return;
      }
      if (t.dataset.coverLang) {
        if (t.dataset.coverLang !== lang) setLang(t.dataset.coverLang);
        hideCover();
        return;
      }
      if (t.dataset.lang) { setLang(t.dataset.lang); return; }
      if (t.dataset.step) { go(t.dataset.step); return; }
      if (t.dataset.goto) { go(t.dataset.goto); return; }
      if (t.dataset.close) { closeSheet(t.dataset.close); return; }
      if (t.dataset.authmode) { renderAuth(t.dataset.authmode); return; }
      if (t.dataset.uapprove) {
        w.Auth.setStatus(t.dataset.uapprove, 'approved').then(function (ok) {
          toast(ok ? '승인했습니다.' : '승인하지 못했습니다.'); renderAdmin();
        });
        return;
      }
      if (t.dataset.ublock) {
        w.Auth.setStatus(t.dataset.ublock, 'blocked').then(function (ok) {
          toast(ok ? '사용을 중지했습니다.' : '처리하지 못했습니다.'); renderAdmin();
        });
        return;
      }
      if (t.dataset.cday) { setDay(parseInt(t.dataset.cday, 10)); closeSheet('daysheet'); go('brief'); return; }

      switch (t.id) {
        case 'day-prev': setDay(day - 1); go(step); break;
        case 'day-next': setDay(day + 1); go(step); break;
        case 'day-open': openDaySheet(); break;
        case 'lvbar': go('trophy'); break;
        case 'btn-share':
          w.Game.share($('#sharebox').textContent, null).then(function (how) {
            if (how === 'copied') toast('글을 복사했습니다. 카카오톡에 붙여넣으십시오.', 3600);
            else if (how === 'failed') toast('복사하지 못했습니다. 글상자를 길게 눌러 복사해 주십시오.', 3600);
          });
          break;
        case 'btn-account': renderAuth('in'); $('#authsheet').classList.remove('hidden'); break;
        case 'au-go': doAuth(($('.authtab.on') || {}).dataset ? $('.authtab.on').dataset.authmode : 'in'); break;
        case 'btn-signout':
          w.Auth.signOut().then(function () { renderAccountBtn(); renderAuth('in'); toast('로그아웃했습니다.'); });
          break;
        case 'btn-admin': renderAdmin(); $('#adminsheet').classList.remove('hidden'); break;
        case 'btn-cover': closeSheet('sheet'); showCover(); break;
        case 'sv-open': w.open('https://supabase.com', '_blank', 'noopener'); break;
        case 'sv-showsql':
          loadSchemaSql().then(function (sql) {
            var ta = $('#sv-sql');
            ta.value = sql || '(schema.sql 을 불러오지 못했습니다)';
            ta.classList.toggle('hidden');
          });
          break;
        case 'sv-copysql':
          loadSchemaSql().then(function (sql) {
            if (!sql) { serverMsg('SQL 을 불러오지 못했습니다.', true); return; }
            var ta = $('#sv-sql');
            ta.classList.remove('hidden'); ta.value = sql; ta.select();
            var ok = false;
            try { ok = d.execCommand('copy'); } catch (e) {}
            serverMsg(ok ? 'SQL 을 복사했습니다. Supabase SQL Editor 에 붙여넣고 Run 하십시오.'
                         : '복사하지 못했습니다. 아래 글상자에서 직접 복사해 주십시오.', !ok);
          });
          break;
        case 'sv-save': {
          var r0 = w.Auth.saveConfig($('#sv-url').value, $('#sv-key').value);
          if (!r0.ok) { serverMsg(r0.msg, true); break; }
          serverMsg('저장했습니다. 화면을 새로 불러옵니다…');
          setTimeout(function () { w.location.reload(); }, 900);
          break;
        }
        case 'sv-clear':
          w.Auth.clearConfig();
          serverMsg('연결을 해제했습니다. 화면을 새로 불러옵니다…');
          setTimeout(function () { w.location.reload(); }, 900);
          break;
        case 'sv-test':
          serverMsg('확인하는 중…');
          w.Auth.diagnose().then(function (r) {
            serverMsg(r.msg, r.step !== 'ok');
          });
          break;
        case 'btn-menu': openSheet(); break;
        case 'btn-setwhy': openSheet(); setTimeout(function () { $('#in-why').focus(); }, 250); break;
        case 'talk-start':
          talk = { i: 0, running: true, ok: 0, skip: 0, saved: false };
          $('#talk-log').innerHTML = '';
          $('#talk-start').textContent = '진행 중…';
          warnVoice();
          talkStep();
          break;
        case 'talk-reset': renderTalk(); w.Speech.stop(); w.Speech.abort(); break;
        case 'btn-complete': {
          if (w.Store.isDone(lang, day)) w.Store.uncomplete(lang, day);
          else {
            var dd = dayData();
            var r = w.Store.dayAvg(lang, day, dd.items.length);
            w.Store.complete(lang, day, { mission: $('#mission-chk').checked, avg: r.avg });
            gain('dayDone');
            w.Game.check(lang, cfg());
            var b = w.Report.blockOf(day);
            toast('Day ' + day + ' 완료. 수고하셨습니다, 대표님.' +
                  (day % w.Report.BLOCK === 0 ? ' — ' + b + '번째 평가가 확정됐습니다.' : ''));
          }
          renderDone(); renderHeader(); renderLvBar(); renderMotive(); syncSoon();
          break;
        }
        case 'btn-install':
          if (deferredPrompt) {
            deferredPrompt.prompt();
            deferredPrompt.userChoice.then(function () { deferredPrompt = null; renderSheet(); });
          } else toast('크롬 오른쪽 위 ⋮ → 홈 화면에 추가 를 눌러 주십시오.', 4000);
          break;
        case 'btn-export': {
          var box = $('#io-box');
          box.classList.remove('hidden');
          box.value = w.Store.exportText();
          box.select();
          try { d.execCommand('copy'); toast('진도를 복사했습니다. 다른 기기에서 불러오기에 붙여넣으십시오.', 4000); }
          catch (e) { toast('아래 글상자를 길게 눌러 복사하십시오.', 4000); }
          break;
        }
        case 'btn-import': {
          var b2 = $('#io-box');
          if (b2.classList.contains('hidden') || !b2.value.trim()) {
            b2.classList.remove('hidden'); b2.value = '';
            b2.placeholder = '다른 기기에서 내보낸 진도를 붙여넣고 [진도 불러오기]를 한 번 더 누르십시오.';
            b2.focus();
          } else if (w.Store.importText(b2.value.trim())) {
            lang = w.Store.lang(); day = todayDay(cfg());
            renderAll(); renderSheet(); toast('진도를 불러왔습니다.');
          } else toast('형식이 맞지 않습니다. 내보낸 값을 그대로 붙여넣어 주십시오.', 3600);
          break;
        }
      }
    });

    ['sheet', 'daysheet', 'authsheet', 'adminsheet'].forEach(function (id) {
      $('#' + id).addEventListener('click', function (ev) { if (ev.target.id === id) closeSheet(id); });
    });
    $('#day-search').addEventListener('input', function () { renderDayList(this.value); });
    $('#in-why').addEventListener('input', function () { w.Store.why(this.value); });
    $('#in-plan').addEventListener('input', function () { w.Store.plan(this.value); });
    $('#rate').addEventListener('input', function () {
      w.Store.rate(parseFloat(this.value));
      $('#rate-val').textContent = '현재 속도 ' + w.Store.rate().toFixed(2) + '배 (느릴수록 또렷)';
    });
    $('#mission-chk').addEventListener('change', function () {
      if (w.Store.isDone(lang, day)) {
        var info = w.Store.getDone(lang, day) || {};
        info.mission = this.checked;
        w.Store.complete(lang, day, info);
      }
    });
    w.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault(); deferredPrompt = e;
    });
    w.addEventListener('pagehide', function () {
      w.Speech.stop(); w.Speech.abort(); w.Rec.cancel(); saveTalk();
    });
  }

  /* ---------------- 시작 ---------------- */

  function boot() {
    var q = new URLSearchParams(w.location.search);
    var ql = q.get('lang');
    lang = (LANGS.indexOf(ql) >= 0) ? ql : w.Store.lang();
    if (!DATA[lang]) {
      lang = LANGS.filter(function (L) { return DATA[L]; })[0];
    }
    w.Store.lang(lang);

    var qd = parseInt(q.get('day'), 10);
    day = qd > 0 ? Math.min(cfg().meta.days, qd) : todayDay(cfg());

    w.Speech.initVoices(function () {});
    wire();
    renderAll();
    renderAccountBtn();
    var seen = '';
    try { seen = w.localStorage.getItem(COVER_KEY) || ''; } catch (e) {}
    if (seen !== w.Store.todayStr() && !q.get('step')) showCover();
    if (authOn()) {
      w.Auth.init().then(function () {
        renderAccountBtn();
        if (w.Auth.user) afterLogin();
      });
    }
    go(q.get('step') || 'brief');

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    }
  }

  function fail(msg) {
    d.getElementById('main').innerHTML =
      '<div class="card"><h3>학습 자료를 불러오지 못했습니다</h3><p class="tip">' + esc(msg) +
      '</p><p class="tip">인터넷 연결을 확인하고 새로고침해 주십시오.</p></div>';
  }


  function loadJSON(path) {
    return fetch(path + '?v=' + VER)
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  Promise.all([
    loadJSON('data/zh.json'), loadJSON('data/en.json'), loadJSON('data/ja.json'),
    loadJSON('data/motivation.json'), loadJSON('data/boston.json'),
    loadJSON('data/boston_guide.json')
  ]).then(function (res) {
    // 아직 원고가 없는 언어는 그냥 빠진다(탭도 숨긴다)
    if (res[0]) DATA.zh = res[0];
    if (res[1]) DATA.en = res[1];
    if (res[2]) DATA.ja = res[2];
    MOTIVE = res[3];                 // 없어도 앱은 돈다
    BOSTON = res[4];
    BGUIDE = res[5];
    if (!Object.keys(DATA).length) return fail('학습 자료(data/*.json)를 읽을 수 없습니다.');
    boot();
  });

})(window, document);
