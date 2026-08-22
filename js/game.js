/* 성취 — 점수·레벨·배지·일일 퀘스트·연속기록·친구 공유
 *
 * 설계 근거 (기분 좋은 장치가 아니라, 지속률을 올린다고 알려진 것만 넣었다)
 *   유능감·자율성·관계성  Deci & Ryan  — 셋을 함께 건드려야 오래 간다
 *   성취욕구 nAch        McClelland   — 중간 난이도 + 즉각 피드백 + 내 책임
 *   목표경사효과          Hull, Kivetz — 목표에 가까울수록 노력이 는다 → 진행바를 늘 보여 준다
 *   손실회피             Kahneman     — 연속기록은 '쌓는 것'보다 '잃는 것'이 더 크게 느껴진다
 *   미완결 효과          Zeigarnik    — 끝내지 않은 퀘스트는 계속 마음에 남는다
 *   사회비교             Festinger    — 비슷한 상대와의 비교만 동기가 된다(고수와 비교하면 꺾인다)
 *
 * 경계한 것
 *   과잉정당화 효과 (Deci 1971) — 외적 보상이 과하면 '좋아서 하던 일'이 '보상 때문에 하는 일'로 바뀐다.
 *   그래서 점수는 상품이 아니라 **피드백**으로만 쓰고, 무작위 보상·연출을 넣지 않았다.
 */
(function (w) {
  'use strict';

  /* ---------- 점수 규칙 ---------- */

  var XP = {
    wordRep: 2,        // 단어 1회 반복 인정
    wordDone: 10,      // 한 단어 5회 채움
    say60: 4, say80: 7, say90: 10,   // 문장 발음 — 최고점을 갱신했을 때만
    tonePerfect: 5,    // 성조 전부 맞춤(중국어)
    talkTurn: 5,       // 대화에서 내 차례 통과
    talkDone: 15,      // 대화 완주
    review: 3,         // 복습 문장 말하기
    dayDone: 25,       // 회차 완료
    boston: 10,        // 보스턴 판정 ○
    quest: 20          // 일일 퀘스트 하나 완료
  };

  // 레벨 문턱 — 뒤로 갈수록 완만하게 늘어난다(달성 가능성을 유지)
  var LEVELS = (function () {
    var a = [0], sum = 0;
    for (var n = 1; n <= 40; n++) { sum += Math.round(60 + Math.pow(n, 1.45) * 22); a.push(sum); }
    return a;
  })();

  // 칭호는 55일 여정의 실제 단계와 붙여 둔다(추상적인 등급보다 와닿는다)
  var TITLES = [
    [1, '첫걸음'], [3, '인사가 트인 사람'], [5, '길을 묻는 사람'], [7, '값을 깎는 사람'],
    [9, '혼자 이동하는 사람'], [12, '혼자 밥 먹는 사람'], [15, '회식에서 버티는 사람'],
    [18, '명함을 건네는 사람'], [21, '미팅을 여는 사람'], [25, '조건을 협의하는 사람'],
    [30, '거절할 줄 아는 사람'], [35, '통역 없이 여는 사람'], [40, '통역 없이 닫는 사람']
  ];

  /* ---------- 배지 ---------- */

  var BADGES = [
    { k: 'first', icon: '🌱', name: '첫걸음', desc: '첫 회차를 마쳤습니다' },
    { k: 'week', icon: '🔥', name: '7일 연속', desc: '이레를 이어 갔습니다' },
    { k: 'fortnight', icon: '🔥', name: '14일 연속', desc: '지겨움 구간을 지났습니다' },
    { k: 'month', icon: '🏔', name: '30일 연속', desc: '한 달을 지켰습니다' },
    { k: 'word100', icon: '🗣', name: '단어 100회', desc: '단어를 100번 소리 내어 말했습니다' },
    { k: 'word500', icon: '🗣', name: '단어 500회', desc: '단어를 500번 말했습니다' },
    { k: 'perfect', icon: '💯', name: '만점 발음', desc: '문장 하나를 100점으로 냈습니다' },
    { k: 'tone', icon: '🎼', name: '성조 완봉', desc: '한 문장의 성조를 모두 맞혔습니다' },
    { k: 'boston', icon: '🎩', name: '보스턴의 귀', desc: '보스턴 판정 5개를 통과했습니다' },
    { k: 'talker', icon: '💬', name: '대화 10편', desc: '대화를 열 번 완주했습니다' },
    { k: 'early', icon: '🌅', name: '새벽반', desc: '오전 7시 전에 공부했습니다' },
    { k: 'comeback', icon: '↩️', name: '돌아온 사람', desc: '하루 쉬고 다시 왔습니다' },
    { k: 'half', icon: '⛳', name: '반환점', desc: '28회차를 마쳤습니다' },
    { k: 'finish', icon: '🏁', name: '완주', desc: '55회차를 모두 마쳤습니다' }
  ];

  /* ---------- 일일 퀘스트 ---------- */

  var QUESTS = [
    { k: 'words', name: '오늘 단어 30회 채우기', hint: '단어 6개 × 5번' },
    { k: 'say', name: '오늘 문장 5개 모두 말하기', hint: '④ 발음에서 마이크로' },
    { k: 'talk', name: '대화 한 편 완주하기', hint: '⑤ 대화에서 끝까지' },
    { k: 'review', name: '복습 문장 3개 말하기', hint: '⑥ 복습에서' },
    { k: 'high', name: '90점 이상 문장 하나 만들기', hint: '한 문장만 집중해서' },
    { k: 'boston', name: '보스턴 판정 2개 받기', hint: '📊 평가 → 보스턴 진단' }
  ];

  function dayKey(d) { return w.Store.todayStr(d); }

  // 날짜를 씨앗으로 삼아 그날의 퀘스트 3개를 정한다(매번 바뀌면 계획을 못 세운다)
  function pickQuests(lang) {
    var key = dayKey(), h = 0;
    for (var i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) % 100000;
    var pool = QUESTS.filter(function (q) { return q.k !== 'boston' || lang === 'en'; });
    var out = [], used = {};
    for (var n = 0; n < 3; n++) {
      var idx = (h + n * 7) % pool.length;
      while (used[idx]) idx = (idx + 1) % pool.length;
      used[idx] = 1;
      out.push(pool[idx]);
    }
    return out;
  }

  var Game = {
    XP: XP, BADGES: BADGES,

    /* ---------- 점수 ---------- */

    add: function (lang, key, n) {
      var amount = (XP[key] || 0) * (n || 1);
      if (!amount) return 0;
      var g = w.Store.game(lang);
      g.xp = (g.xp || 0) + amount;
      g.log = g.log || {};
      var d = dayKey();
      g.log[d] = (g.log[d] || 0) + amount;
      w.Store.saveGame(lang, g);
      return amount;
    },

    // 문장 점수는 최고점을 갱신했을 때만 준다 — 같은 문장 반복으로 점수를 쌓는 걸 막는다
    xpForScore: function (score) {
      return score >= 90 ? 'say90' : score >= 80 ? 'say80' : score >= 60 ? 'say60' : null;
    },

    total: function (lang) { return (w.Store.game(lang).xp) || 0; },

    todayXP: function (lang) {
      var g = w.Store.game(lang);
      return (g.log && g.log[dayKey()]) || 0;
    },

    weekXP: function (lang) {
      var g = w.Store.game(lang), sum = 0, cur = new Date();
      for (var i = 0; i < 7; i++) {
        sum += (g.log && g.log[dayKey(cur)]) || 0;
        cur.setDate(cur.getDate() - 1);
      }
      return sum;
    },

    /* ---------- 레벨 ---------- */

    level: function (lang) {
      var xp = this.total(lang), lv = 1;
      for (var i = 1; i < LEVELS.length; i++) if (xp >= LEVELS[i]) lv = i + 1;
      var floor = LEVELS[lv - 1] || 0;
      var next = LEVELS[lv] != null ? LEVELS[lv] : floor;
      var need = Math.max(1, next - floor);
      var title = TITLES[0][1];
      TITLES.forEach(function (t) { if (lv >= t[0]) title = t[1]; });
      return {
        lv: lv, title: title, xp: xp,
        into: xp - floor, need: need,
        pct: Math.min(100, Math.round((xp - floor) / need * 100)),
        toNext: Math.max(0, next - xp),
        max: lv >= LEVELS.length
      };
    },

    /* ---------- 일일 퀘스트 ---------- */

    quests: function (lang, cfg, day) {
      var qs = pickQuests(lang);
      var st = w.Store.state[lang];
      var dd = null;
      for (var i = 0; i < cfg.days.length; i++) if (cfg.days[i].d === day) dd = cfg.days[i];
      if (!dd) return [];

      var wp = w.Store.wordProgress(lang, day, (dd.words || []).length);
      var said = 0, high = 0;
      (dd.items || []).forEach(function (_x, idx) {
        var v = st.scores[day + '-' + idx];
        if (v != null) { said++; if (v >= 90) high++; }
      });
      var tk = w.Store.getTalk(lang, day);
      var reviewN = 0;
      Object.keys(st.scores).forEach(function (k) {
        if (+k.split('-')[0] < day) reviewN++;
      });
      var bo = w.Store.bostonScore('en');

      var val = {
        words: { cur: wp.reps, goal: wp.need || 30 },
        say: { cur: said, goal: (dd.items || []).length },
        // 대화는 '기록이 있다'가 아니라 '내 차례를 한 번이라도 통과했다'로 본다
        talk: { cur: (tk && tk.ok > 0) ? 1 : 0, goal: 1 },
        review: { cur: Math.min(reviewN, 3), goal: 3 },
        high: { cur: high, goal: 1 },
        boston: { cur: bo.n, goal: 2 }
      };

      var g = w.Store.game(lang);
      g.quests = g.quests || {};
      var dk = dayKey();
      g.quests[dk] = g.quests[dk] || {};
      var changed = false;

      var out = qs.map(function (q) {
        var v = val[q.k] || { cur: 0, goal: 1 };
        var done = v.cur >= v.goal;
        // 처음 달성한 순간에만 보너스를 준다
        if (done && !g.quests[dk][q.k]) {
          g.quests[dk][q.k] = 1;
          g.xp = (g.xp || 0) + XP.quest;
          g.log = g.log || {};
          g.log[dk] = (g.log[dk] || 0) + XP.quest;
          changed = true;
        }
        return { k: q.k, name: q.name, hint: q.hint, cur: Math.min(v.cur, v.goal), goal: v.goal, done: done };
      });
      if (changed) w.Store.saveGame(lang, g);
      return out;
    },

    /* ---------- 배지 ---------- */

    check: function (lang, cfg) {
      var g = w.Store.game(lang);
      g.badges = g.badges || {};
      var st = w.Store.state[lang];
      var got = [];

      function give(k) {
        if (g.badges[k]) return;
        g.badges[k] = dayKey();
        got.push(k);
      }

      var doneN = w.Store.doneCount(lang);
      var streak = w.Store.streak();
      if (doneN >= 1) give('first');
      if (doneN >= 28) give('half');
      if (doneN >= (cfg ? cfg.meta.days : 55)) give('finish');
      if (streak >= 7) give('week');
      if (streak >= 14) give('fortnight');
      if (streak >= 30) give('month');

      var reps = 0;
      Object.keys(st.words).forEach(function (k) { reps += st.words[k].reps || 0; });
      if (reps >= 100) give('word100');
      if (reps >= 500) give('word500');

      var best = 0;
      Object.keys(st.scores).forEach(function (k) { if (st.scores[k] > best) best = st.scores[k]; });
      if (best >= 100) give('perfect');

      Object.keys(st.tones).forEach(function (k) {
        var t = st.tones[k];
        if (t && t.judged >= 2 && t.hit === t.judged) give('tone');
      });

      if (w.Store.bostonScore('en').ok >= 5) give('boston');
      if (Object.keys(st.talk).length >= 10) give('talker');
      if (new Date().getHours() < 7) give('early');

      // 하루 쉬고 돌아왔는가 — 자책 대신 배지를 준다(자기자비)
      var dates = Object.keys(st.done).map(function (k) { return st.done[k].date; })
                        .filter(Boolean).sort();
      for (var i = 1; i < dates.length; i++) {
        var gap = (new Date(dates[i]) - new Date(dates[i - 1])) / 86400000;
        if (gap >= 2 && gap <= 4) { give('comeback'); break; }
      }

      if (got.length) w.Store.saveGame(lang, g);
      return { owned: g.badges, fresh: got };
    },

    badgeOf: function (k) {
      for (var i = 0; i < BADGES.length; i++) if (BADGES[i].k === k) return BADGES[i];
      return null;
    },

    /* ---------- 친구에게 보내기 ---------- */

    shareText: function (lang, cfg, day) {
      var L = this.level(lang);
      var streak = w.Store.streak();
      var name = cfg.meta.lang;
      var lines = [];
      lines.push('[매일 언어] 오늘 ' + name + ' Day ' + day + ' 마쳤습니다.');
      lines.push('레벨 ' + L.lv + ' · ' + L.title + ' · ' + L.xp.toLocaleString() + '점');
      if (streak > 1) lines.push('연속 ' + streak + '일째');
      var bo = w.Store.bostonScore('en');
      if (lang === 'en' && bo.n) lines.push('보스턴 발음 ' + bo.rate + '% (' + bo.ok + '/' + bo.n + ')');
      lines.push('');
      lines.push('같이 하실 분? → ' + w.location.origin + w.location.pathname);
      return lines.join('\n');
    },

    share: function (text, onFallback) {
      if (w.navigator && w.navigator.share) {
        return w.navigator.share({ title: '매일 언어', text: text })
          .then(function () { return 'shared'; })
          .catch(function () { return 'cancelled'; });
      }
      // 공유창이 없는 환경(주로 PC)에서는 복사해 드린다
      var ok = false;
      try {
        var ta = w.document.createElement('textarea');
        ta.value = text; w.document.body.appendChild(ta); ta.select();
        ok = w.document.execCommand('copy');
        w.document.body.removeChild(ta);
      } catch (e) { ok = false; }
      if (onFallback) onFallback(ok);
      return Promise.resolve(ok ? 'copied' : 'failed');
    }
  };

  w.Game = Game;
})(window);
