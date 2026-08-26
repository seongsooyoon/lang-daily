/* 진도 저장 — localStorage 전용. 서버·로그인 없음.
 *
 * 저장하는 것
 *   done   회차 완료 기록          { "3": {date, mission, avg} }
 *   scores 문장별 최고 점수         { "3-0": 88 }
 *   words  단어별 반복 횟수·최고점  { "3-0": {reps:5, best:92} }
 *   tones  성조 판정 누적(중국어)   { "3-0": {hit:3, judged:4} }
 *   sounds 소리별 정답/오답 집계    { "th": {ok:12, no:5} }
 *   talk   대화 결과               { "3": {turns:6, ok:5, skip:1, date} }
 *   reports 7회차 주기 평가         { "7": {...} }
 */
(function (w) {
  'use strict';
  var KEY = 'langdaily.v1';

  var LANGS = ['zh', 'en', 'ja'];          // 언어를 늘릴 때 여기 한 곳만 고친다

  function blankLang() {
    return { done: {}, scores: {}, words: {}, tones: {}, sounds: {}, talk: {},
             reports: {}, boston: {},
             // 성취(점수·배지·퀘스트) — game.js 가 읽고 쓴다
             game: { xp: 0, log: {}, badges: {}, quests: {} } };
  }

  function blank() {
    var b = { v: 4, lang: 'zh', rate: 0.8, why: '', plan: '' };
    LANGS.forEach(function (L) { b[L] = blankLang(); });
    return b;
  }

  function read() {
    try {
      var raw = w.localStorage.getItem(KEY);
      if (!raw) return blank();
      var o = JSON.parse(raw);
      var b = blank();
      if (!o || typeof o !== 'object') return b;
      b.lang = (LANGS.indexOf(o.lang) >= 0) ? o.lang : 'zh';
      b.rate = (typeof o.rate === 'number' && o.rate >= 0.4 && o.rate <= 1.4) ? o.rate : 0.8;
      b.why = typeof o.why === 'string' ? o.why : '';
      b.plan = typeof o.plan === 'string' ? o.plan : '';
      // 예전 진도도 그대로 살린다 — 없는 칸만 빈 값으로 채운다
      LANGS.forEach(function (L) {
        if (!o[L] || typeof o[L] !== 'object') return;
        Object.keys(blankLang()).forEach(function (k) {
          if (o[L][k] && typeof o[L][k] === 'object') b[L][k] = o[L][k];
        });
        // 예전 진도에는 game 칸이 없다 — 빈 값으로 채워 둔다
        var gm = b[L].game || {};
        b[L].game = { xp: gm.xp || 0, log: gm.log || {}, badges: gm.badges || {}, quests: gm.quests || {} };
      });
      return b;
    } catch (e) { return blank(); }
  }

  // 날짜는 반드시 '이 기기의 날짜'로 찍는다.
  // toISOString() 은 UTC 라서, 한국 아침 7시 학습이 전날로 기록돼 연속일수가 어긋난다.
  function todayStr(d) {
    var x = d || new Date();
    return new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }

  function write(s) {
    try { w.localStorage.setItem(KEY, JSON.stringify(s)); return true; }
    catch (e) { return false; }   // 시크릿 창·저장소 차단에서도 앱은 계속 돌아야 한다
  }

  /* ---------- 두 기기의 진도 합치기 ----------
   * 덮어쓰지 않는다. 엣지에서 6회차까지, 크롬에서 3회차까지 했다면 둘 다 남아야 한다.
   * 규칙: 숫자는 큰 쪽 · 참/거짓은 하나라도 참이면 참 · 목록은 합집합 ·
   *       날짜 문자열은 나중 것 · 그 밖의 문자열은 서버 쪽.
   * 점수·반복횟수·XP 가 모두 '많이 한 쪽'이 이기므로 되돌아가는 일이 없다.
   */
  function mergeVal(a, b) {
    if (a === undefined || a === null) return b;
    if (b === undefined || b === null) return a;
    if (typeof a === 'number' && typeof b === 'number') return Math.max(a, b);
    if (typeof a === 'boolean' || typeof b === 'boolean') return !!(a || b);
    if (Array.isArray(a) && Array.isArray(b)) {
      var out = a.slice();
      b.forEach(function (x) { if (out.indexOf(x) < 0) out.push(x); });
      return out;
    }
    if (typeof a === 'object' && typeof b === 'object') {
      var o = {}, k;
      for (k in a) if (Object.prototype.hasOwnProperty.call(a, k)) o[k] = a[k];
      for (k in b) if (Object.prototype.hasOwnProperty.call(b, k)) {
        o[k] = Object.prototype.hasOwnProperty.call(a, k) ? mergeVal(a[k], b[k]) : b[k];
      }
      return o;
    }
    // 'YYYY-MM-DD' 끼리는 나중 날짜가 맞다(마지막 학습일 등)
    if (typeof a === 'string' && typeof b === 'string' &&
        /^\d{4}-\d{2}-\d{2}/.test(a) && /^\d{4}-\d{2}-\d{2}/.test(b)) {
      return a > b ? a : b;
    }
    return b;
  }

  var Store = {
    state: read(),
    LANGS: LANGS,
    todayStr: todayStr,      // 다른 모듈도 같은 기준으로 날짜를 찍게 한다
    onSave: null,            // 저장될 때마다 불린다(app.js 가 서버 올리기를 건다)
    save: function () {
      var ok = write(this.state);
      if (typeof this.onSave === 'function') { try { this.onSave(); } catch (e) {} }
      return ok;
    },

    // 서버에서 받은 한 언어의 진도를 로컬과 합친다. 실제로 달라졌으면 true.
    mergeLang: function (lang, remote) {
      if (!remote || typeof remote !== 'object') return false;
      var before = JSON.stringify(this.state[lang] || {});
      var merged = mergeVal(this.state[lang] || blankLang(), remote);
      // 빈 칸이 생기지 않게 기본 모양을 보장한다
      var base = blankLang(), k;
      for (k in base) if (!(k in merged)) merged[k] = base[k];
      this.state[lang] = merged;
      var changed = JSON.stringify(merged) !== before;
      if (changed) write(this.state);
      return changed;
    },

    lang: function (v) { if (v) { this.state.lang = v; this.save(); } return this.state.lang; },
    // 왜 하는가(자율적 동기) · 언제 어디서 할 것인가(실행의도) — 둘 다 지속률을 올리는 장치
    why: function (v) { if (v != null) { this.state.why = String(v).slice(0, 300); this.save(); } return this.state.why || ''; },
    plan: function (v) { if (v != null) { this.state.plan = String(v).slice(0, 300); this.save(); } return this.state.plan || ''; },

    /* ---------- 성취(점수·배지·퀘스트) ---------- */
    game: function (lang) {
      var g = this.state[lang].game;
      if (!g) { g = { xp: 0, log: {}, badges: {}, quests: {} }; this.state[lang].game = g; }
      return g;
    },
    saveGame: function (lang, g) { this.state[lang].game = g; this.save(); },

    /* ---------- 보스턴 발음 진단 ---------- */
    putBoston: function (lang, key, word, res) {
      var g = this.state[lang].boston[key] || {};
      g[word] = { ok: res.ok, rise: res.rise, conf: res.conf, date: todayStr() };
      this.state[lang].boston[key] = g;
      this.save();
    },
    getBoston: function (lang, key, word) {
      var g = this.state[lang].boston[key];
      return (g && g[word]) || null;
    },
    bostonScore: function (lang, keys) {
      var ok = 0, n = 0, st = this.state[lang].boston;
      (keys || Object.keys(st)).forEach(function (k) {
        var g = st[k]; if (!g) return;
        Object.keys(g).forEach(function (wd) {
          if (g[wd].ok === null || g[wd].ok === undefined) return;
          n++; if (g[wd].ok) ok++;
        });
      });
      return { ok: ok, n: n, rate: n ? Math.round(ok / n * 100) : null };
    },
    rate: function (v) { if (typeof v === 'number') { this.state.rate = v; this.save(); } return this.state.rate; },

    /* ---------- 문장 발음 점수 ---------- */

    // 같은 문장을 여러 번 말하면 잘한 쪽을 남긴다
    putScore: function (lang, day, idx, score) {
      var k = day + '-' + idx, cur = this.state[lang].scores[k];
      if (cur == null || score > cur) { this.state[lang].scores[k] = score; this.save(); }
      return this.state[lang].scores[k];
    },
    getScore: function (lang, day, idx) {
      var v = this.state[lang].scores[day + '-' + idx];
      return (v == null) ? null : v;
    },
    dayAvg: function (lang, day, n) {
      var sum = 0, cnt = 0;
      for (var i = 0; i < n; i++) {
        var v = this.getScore(lang, day, i);
        if (v != null) { sum += v; cnt++; }
      }
      return cnt ? { avg: Math.round(sum / cnt), cnt: cnt } : { avg: null, cnt: 0 };
    },

    /* ---------- 단어 반복 ---------- */

    REPS: 5,                                     // 단어당 목표 반복 횟수
    addWordRep: function (lang, day, idx, score) {
      var k = day + '-' + idx, cur = this.state[lang].words[k] || { reps: 0, best: 0 };
      cur.reps += 1;
      if (score != null && score > cur.best) cur.best = score;
      this.state[lang].words[k] = cur;
      this.save();
      return cur;
    },
    getWord: function (lang, day, idx) {
      return this.state[lang].words[day + '-' + idx] || { reps: 0, best: 0 };
    },
    wordProgress: function (lang, day, n) {
      var doneW = 0, total = 0;
      for (var i = 0; i < n; i++) {
        var v = this.getWord(lang, day, i);
        total += Math.min(this.REPS, v.reps);
        if (v.reps >= this.REPS) doneW++;
      }
      return { reps: total, need: n * this.REPS, words: doneW, of: n };
    },

    /* ---------- 성조 판정 (중국어) ---------- */

    putTone: function (lang, day, idx, hit, judged) {
      if (!judged) return;
      this.state[lang].tones[day + '-' + idx] = { hit: hit, judged: judged };
      this.save();
    },

    /* ---------- 소리별 약점 ---------- */

    addSound: function (lang, key, ok) {
      var s = this.state[lang].sounds[key] || { ok: 0, no: 0 };
      if (ok) s.ok++; else s.no++;
      this.state[lang].sounds[key] = s;
      this.save();
    },

    /* ---------- 대화 ---------- */

    putTalk: function (lang, day, turns, ok, skip) {
      this.state[lang].talk[String(day)] = {
        turns: turns, ok: ok, skip: skip, date: todayStr()
      };
      this.save();
    },
    getTalk: function (lang, day) { return this.state[lang].talk[String(day)] || null; },

    /* ---------- 회차 완료 ---------- */

    isDone: function (lang, day) { return !!this.state[lang].done[String(day)]; },
    getDone: function (lang, day) { return this.state[lang].done[String(day)] || null; },
    complete: function (lang, day, info) {
      this.state[lang].done[String(day)] = Object.assign({ date: todayStr() }, info || {});
      this.save();
    },
    uncomplete: function (lang, day) { delete this.state[lang].done[String(day)]; this.save(); },
    doneCount: function (lang) { return Object.keys(this.state[lang].done).length; },

    /* ---------- 7회차 주기 평가 저장 ---------- */

    putReport: function (lang, block, data) {
      this.state[lang].reports[String(block)] = data;
      this.save();
    },
    getReport: function (lang, block) { return this.state[lang].reports[String(block)] || null; },
    reportBlocks: function (lang) {
      return Object.keys(this.state[lang].reports)
        .map(Number).sort(function (a, b) { return a - b; });
    },

    /* ---------- 연속 학습일 ---------- */

    streak: function () {
      var dates = {};
      LANGS.forEach(function (L) {
        var d = this.state[L].done;
        for (var k in d) if (d[k] && d[k].date) dates[d[k].date] = 1;
      }, this);
      var n = 0, cur = new Date();
      for (;;) {
        if (dates[todayStr(cur)]) { n++; cur.setDate(cur.getDate() - 1); }
        else if (n === 0) {
          // 오늘 아직 안 했을 수 있으니 어제까지는 한 번 봐준다
          cur.setDate(cur.getDate() - 1);
          if (!dates[todayStr(cur)]) return 0;
        } else return n;
      }
    },

    exportText: function () { return JSON.stringify(this.state); },
    importText: function (txt) {
      try {
        var o = JSON.parse(txt);
        if (!o || (!o.zh && !o.en)) return false;
        w.localStorage.setItem(KEY, JSON.stringify(o));
        this.state = read();
        return true;
      } catch (e) { return false; }
    }
  };

  w.Store = Store;
})(window);
