/* 매일 언어 — 화면·흐름 제어 */
(function (w, d) {
  'use strict';

  var DATA = {};                 // { zh: {...}, en: {...} }
  var lang = 'zh';
  var day = 1;
  var step = 'brief';
  var talk = { i: 0, running: false };

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
  function parseDate(s) {
    var p = String(s).split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }
  function daysBetween(a, b) { return Math.round((b - a) / 86400000); }

  function todayDay(cfg) {
    var n = daysBetween(parseDate(cfg.meta.start), today()) + 1;
    return Math.max(1, Math.min(cfg.meta.days, n));
  }
  function cfg() { return DATA[lang]; }
  function dayData(n) {
    var list = cfg().days;
    for (var i = 0; i < list.length; i++) if (list[i].d === (n == null ? day : n)) return list[i];
    return list[0];
  }

  /* ---------------- 렌더 ---------------- */

  function renderHeader() {
    var c = cfg(), dd = dayData();
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
    $$('.langtab').forEach(function (b) { b.classList.toggle('on', b.dataset.lang === lang); });
    $$('.steps button').forEach(function (b) {
      b.classList.toggle('on', b.dataset.step === step);
    });
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
    if (dd.accent) { $('#b-accent-body').textContent = dd.accent; box.classList.remove('hidden'); }
    else box.classList.add('hidden');
  }

  function itemCard(it, i, opts) {
    opts = opts || {};
    var c = cfg();
    var sc = opts.showScore ? w.Store.getScore(lang, opts.srcDay || day, i) : null;
    var h = '';
    h += '<div class="item" data-lang="' + lang + '" data-idx="' + i + '"' +
         (opts.srcDay ? ' data-srcday="' + opts.srcDay + '"' : '') + '>';
    h += '<div class="num">' + esc(opts.label || (i + 1)) + '</div>';
    h += '<div class="main">' + esc(it.text) + '</div>';
    h += '<div class="phon">' + esc(it.phon) + '</div>';
    if (it.kr) h += '<div class="kr">[' + esc(it.kr) + ']</div>';
    h += '<div class="ko">' + esc(it.ko) + '</div>';
    h += '<div class="row">';
    h += '<button class="playbtn" data-play="' + esc(it.text) + '">▶ 듣기</button>';
    h += '<button class="playbtn slow" data-play="' + esc(it.text) + '" data-slow="1">🐢 느리게</button>';
    if (opts.mic) {
      h += '<button class="micbtn" data-mic="' + esc(it.text) + '">🎙 따라 말하기</button>';
      if (sc != null) h += '<span class="num" style="margin-left:auto">최고 ' + sc + '점</span>';
    }
    h += '</div>';
    if (opts.mic) h += '<div class="result"></div>';
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
        '듣기·따라 말하기는 그대로 하시고, 채점이 필요하면 <b>크롬</b>으로 열어주십시오.';
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
    talk = { i: 0, running: false };
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
      h += itemCard(r.item, r.idx, {
        srcDay: r.srcDay, mic: true, showScore: true,
        label: 'D-' + r.off + ' · ' + r.srcDay + '회차'
      });
    });
    wk.forEach(function (r) {
      h += itemCard(r.item, r.idx, {
        srcDay: r.srcDay, mic: true, showScore: true,
        label: '약점 · ' + r.srcDay + '회차 (' + r.score + '점)'
      });
    });
    $('#review-list').innerHTML = h;
  }

  function renderDone() {
    var dd = dayData(), done = w.Store.getDone(lang, day);
    $('#mission-txt').textContent = dd.mission;
    $('#mission-chk').checked = !!(done && done.mission);

    var r = w.Store.dayAvg(lang, day, dd.items.length);
    var h = '';
    h += '<div class="srow"><span>오늘 회차</span><b>Day ' + day + ' · ' + esc(dd.theme) + '</b></div>';
    h += '<div class="srow"><span>발음 평균</span><b>' +
         (r.cnt ? (r.avg + '점 (' + r.cnt + '/' + dd.items.length + ')') : '아직 없음') + '</b></div>';
    h += '<div class="srow"><span>완료한 회차</span><b>' +
         w.Store.doneCount(lang) + ' / ' + cfg().meta.days + '</b></div>';
    h += '<div class="srow"><span>연속 학습</span><b>' + w.Store.streak() + '일</b></div>';
    $('#done-summary').innerHTML = h;
    $('#btn-complete').textContent = w.Store.isDone(lang, day) ? '✔ 완료됨 — 취소하려면 누르기' : '오늘 학습 완료';
  }

  function renderAll() {
    renderHeader(); renderBrief(); renderLearn(); renderSay(); renderTalk(); renderReview(); renderDone();
  }

  function go(s) {
    step = s;
    $$('.step').forEach(function (el) { el.classList.toggle('on', el.dataset.step === s); });
    $$('.steps button').forEach(function (b) { b.classList.toggle('on', b.dataset.step === s); });
    if (s === 'done') renderDone();
    if (s === 'review') renderReview();
    if (s === 'say') updateSayScore();
    if (s !== 'talk') { talk.running = false; w.Speech.stop(); w.Speech.abort(); }
    w.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function setLang(L) {
    if (L === lang) return;
    w.Speech.stop(); w.Speech.abort();
    lang = L; w.Store.lang(L);
    day = todayDay(cfg());
    renderAll(); go('brief');
  }

  function setDay(n) {
    var c = cfg();
    day = Math.max(1, Math.min(c.meta.days, n));
    w.Speech.stop(); w.Speech.abort();
    renderAll();
  }

  /* ---------------- 듣기·말하기 ---------------- */

  function say(text, slow) {
    var c = cfg();
    w.Speech.speak(text, c.meta.tts, (slow ? 0.55 : w.Store.rate()));
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
      var best = w.Store.putScore(lang, srcDay, idx, r.score);
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

  /* ---------------- 대화 엔진 ---------------- */

  function turnHTML(t, i) {
    var me = t.who === 'me';
    var h = '<div class="turn ' + (me ? 'me' : 'them') + '" data-turn="' + i + '">';
    h += '<div class="t-main">' + esc(t.text) + '</div>';
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
      var end = d.createElement('div');
      end.className = 'card';
      end.innerHTML = '<p class="tip">대화를 끝까지 마쳤습니다. 한 번 더 하시면 훨씬 빨리 입에 붙습니다.</p>';
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

  function talkMic(i, btn) {
    var dd = dayData(), turn = dd.dialogue.turns[i];
    var el = $('.turn[data-turn="' + i + '"]');
    var res = el.querySelector('.t-res');
    var c = cfg();

    if (!w.Speech.canListen()) { advanceTurn(i, '채점 없이 진행합니다.'); return; }
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
        advanceTurn(i);
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

  function advanceTurn(i, note) {
    var el = $('.turn[data-turn="' + i + '"]');
    if (el) {
      el.classList.remove('waiting');
      var b = el.querySelector('[data-tmic]'); if (b) b.remove();
      var s = el.querySelector('[data-tskip]'); if (s) s.remove();
      if (note) { var r = el.querySelector('.t-res'); r.classList.remove('hidden'); r.textContent = note; }
    }
    if (talk.i === i) { talk.i++; setTimeout(talkStep, 300); }
  }

  /* ---------------- 설정 시트 ---------------- */

  function renderSheet() {
    var c = cfg();
    var doneN = w.Store.doneCount(lang);
    var todayN = todayDay(c);
    var allScores = Object.keys(w.Store.state[lang].scores);
    var avg = allScores.length
      ? Math.round(allScores.reduce(function (a, k) { return a + w.Store.state[lang].scores[k]; }, 0) / allScores.length)
      : null;

    $('#statgrid').innerHTML =
      '<div class="stat"><b>' + doneN + '</b><span>완료 회차</span></div>' +
      '<div class="stat"><b>' + w.Store.streak() + '</b><span>연속 학습일</span></div>' +
      '<div class="stat"><b>' + (avg == null ? '–' : avg) + '</b><span>발음 평균</span></div>';

    var h = '';
    for (var i = 1; i <= c.meta.days; i++) {
      var cls = 'cday';
      if (w.Store.isDone(lang, i)) cls += ' done';
      if (i === day) cls += ' now';
      else if (i > todayN) cls += ' future';
      h += '<button class="' + cls + '" data-cday="' + i + '">' + i + '</button>';
    }
    $('#calendar').innerHTML = h;
    $('#rate-val').textContent = '현재 속도 ' + w.Store.rate().toFixed(2) + '배 (느릴수록 또렷)';
    $('#rate').value = w.Store.rate();
  }

  function openSheet() { renderSheet(); $('#sheet').classList.remove('hidden'); }
  function closeSheet() { $('#sheet').classList.add('hidden'); $('#io-box').classList.add('hidden'); }

  /* ---------------- 이벤트 ---------------- */

  function wire() {
    d.addEventListener('click', function (ev) {
      var t = ev.target.closest('button');
      if (!t) return;

      if (t.dataset.play != null) { warnVoice(); say(t.dataset.play, t.dataset.slow === '1'); return; }
      if (t.dataset.mic != null) { doMic(t); return; }
      if (t.dataset.tmic != null) { talkMic(parseInt(t.dataset.tmic, 10), t); return; }
      if (t.dataset.tskip != null) { advanceTurn(parseInt(t.dataset.tskip, 10), '건너뛰었습니다.'); return; }
      if (t.dataset.lang) { setLang(t.dataset.lang); return; }
      if (t.dataset.step) { go(t.dataset.step); return; }
      if (t.dataset.goto) { go(t.dataset.goto); return; }
      if (t.dataset.cday) { setDay(parseInt(t.dataset.cday, 10)); closeSheet(); go('brief'); return; }

      switch (t.id) {
        case 'day-prev': setDay(day - 1); go(step); break;
        case 'day-next': setDay(day + 1); go(step); break;
        case 'btn-menu': openSheet(); break;
        case 'sheet-close': closeSheet(); break;
        case 'talk-start':
          talk = { i: 0, running: true };
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
            toast('Day ' + day + ' 완료. 수고하셨습니다, 대표님.');
          }
          renderDone(); renderHeader();
          break;
        }
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

    $('#sheet').addEventListener('click', function (ev) { if (ev.target.id === 'sheet') closeSheet(); });
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
    w.addEventListener('pagehide', function () { w.Speech.stop(); w.Speech.abort(); });
  }

  /* ---------------- 시작 ---------------- */

  function boot() {
    var q = new URLSearchParams(w.location.search);
    var ql = q.get('lang');
    lang = (ql === 'en' || ql === 'zh') ? ql : w.Store.lang();
    if (!DATA[lang]) lang = DATA.zh ? 'zh' : 'en';
    w.Store.lang(lang);

    var qd = parseInt(q.get('day'), 10);
    day = qd > 0 ? Math.min(cfg().meta.days, qd) : todayDay(cfg());

    w.Speech.initVoices(function () {});
    wire();
    renderAll();
    go('brief');
  }

  function fail(msg) {
    d.getElementById('main').innerHTML =
      '<div class="card"><h3>학습 자료를 불러오지 못했습니다</h3><p class="tip">' + esc(msg) +
      '</p><p class="tip">인터넷 연결을 확인하고 새로고침해 주십시오.</p></div>';
  }

  Promise.all([
    fetch('data/zh.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
    fetch('data/en.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
  ]).then(function (res) {
    if (res[0]) DATA.zh = res[0];
    if (res[1]) DATA.en = res[1];
    if (!DATA.zh && !DATA.en) return fail('data/zh.json · data/en.json 을 읽을 수 없습니다.');
    boot();
  });

})(window, document);
