/* 진도 저장 — localStorage 전용. 서버·로그인 없음. */
(function (w) {
  'use strict';
  var KEY = 'langdaily.v1';

  function blank() {
    return { v: 1, lang: 'zh', rate: 0.8, zh: { done: {}, scores: {} }, en: { done: {}, scores: {} } };
  }

  function read() {
    try {
      var raw = w.localStorage.getItem(KEY);
      if (!raw) return blank();
      var o = JSON.parse(raw);
      // 스키마가 달라졌거나 깨진 값이 와도 화면이 죽지 않도록 빈 값을 덮어씌운다.
      var b = blank();
      if (!o || typeof o !== 'object') return b;
      b.lang = (o.lang === 'en' || o.lang === 'zh') ? o.lang : 'zh';
      b.rate = (typeof o.rate === 'number' && o.rate >= 0.4 && o.rate <= 1.4) ? o.rate : 0.8;
      ['zh', 'en'].forEach(function (L) {
        if (o[L] && typeof o[L] === 'object') {
          b[L].done = o[L].done && typeof o[L].done === 'object' ? o[L].done : {};
          b[L].scores = o[L].scores && typeof o[L].scores === 'object' ? o[L].scores : {};
        }
      });
      return b;
    } catch (e) { return blank(); }
  }

  function write(s) {
    try { w.localStorage.setItem(KEY, JSON.stringify(s)); return true; }
    catch (e) { return false; }   // 시크릿 창·저장소 차단에서도 앱은 계속 돌아야 한다
  }

  var Store = {
    state: read(),
    save: function () { return write(this.state); },

    lang: function (v) {
      if (v) { this.state.lang = v; this.save(); }
      return this.state.lang;
    },
    rate: function (v) {
      if (typeof v === 'number') { this.state.rate = v; this.save(); }
      return this.state.rate;
    },

    // 문장별 최고점 기록 (같은 문장을 여러 번 말하면 잘한 쪽을 남긴다)
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

    isDone: function (lang, day) { return !!this.state[lang].done[String(day)]; },
    getDone: function (lang, day) { return this.state[lang].done[String(day)] || null; },
    complete: function (lang, day, info) {
      this.state[lang].done[String(day)] = Object.assign(
        { date: new Date().toISOString().slice(0, 10) }, info || {});
      this.save();
    },
    uncomplete: function (lang, day) {
      delete this.state[lang].done[String(day)];
      this.save();
    },
    doneCount: function (lang) { return Object.keys(this.state[lang].done).length; },

    // 연속 학습일수 — 완료 기록의 날짜를 오늘부터 거꾸로 훑는다(언어 합산).
    streak: function () {
      var dates = {};
      ['zh', 'en'].forEach(function (L) {
        var d = this.state[L].done;
        for (var k in d) if (d[k] && d[k].date) dates[d[k].date] = 1;
      }, this);
      var n = 0, cur = new Date();
      for (;;) {
        var key = new Date(cur.getTime() - cur.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
        if (dates[key]) { n++; cur.setDate(cur.getDate() - 1); }
        else if (n === 0) {
          // 오늘 아직 안 했을 수 있으니 어제까지는 한 번 봐준다
          cur.setDate(cur.getDate() - 1);
          var y = new Date(cur.getTime() - cur.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
          if (!dates[y]) return 0;
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
