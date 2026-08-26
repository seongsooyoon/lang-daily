/* 발음 평가 — 잘되는 소리·안 되는 소리 진단, 7회차 주기 리포트, 누적 추이
 *
 * 점수는 어디서 오는가
 *   문장·단어 : 음성인식 결과를 정답과 대조한 점수 (speech.js)
 *   성조      : 녹음한 목소리의 음높이 곡선 판정 (record.js) — 중국어만
 *   대화      : 대화 단계에서 내 차례를 인식으로 통과한 비율
 * 셋 다 원어민 심사가 아니라 기계 판정이므로, 절대 점수보다 **추이**를 보는 것이 맞다.
 */
(function (w) {
  'use strict';

  var BLOCK = 7;                                  // 7회차마다 한 번 평가

  /* ---------- 소리 분류 ---------- */

  // 중국어 성모(음절 첫 자음). 긴 것부터 봐야 zh/ch/sh 를 z/c/s 로 잘못 읽지 않는다.
  var INITIALS = ['zh', 'ch', 'sh', 'b', 'p', 'm', 'f', 'd', 't', 'n', 'l', 'g', 'k', 'h',
                  'j', 'q', 'x', 'r', 'z', 'c', 's', 'y', 'w'];
  var VOWEL = /[aeiouüvāēīōūǖáéíóúǘǎěǐǒǔǚàèìòùǜ]/i;

  // 병음을 음절로 끊어 각 음절의 성모를 돌려준다. 음절 수 = 한자 수와 맞는다.
  // 음절 분해는 record.js 의 pinyinSplit 과 같은 규칙을 써야 표시와 집계가 어긋나지 않는다.
  function initialOf(syl) {
    var t = String(syl || '').toLowerCase().replace(/[^a-zü]/g, '');
    var head = t.replace(/[aeiouü].*$/, '');       // 첫 모음 앞까지가 성모
    for (var m = 0; m < INITIALS.length; m++) {
      if (head === INITIALS[m]) return head;
    }
    return head.slice(0, 2) === 'zh' || head.slice(0, 2) === 'ch' || head.slice(0, 2) === 'sh'
      ? head.slice(0, 2) : head.slice(0, 1);
  }
  function initials(pinyin) {
    if (w.Rec && w.Rec.pinyinSplit) return w.Rec.pinyinSplit(pinyin).map(initialOf);
    return initialsFallback(pinyin);
  }
  function initialsFallback(pinyin) {
    var s = String(pinyin || '').toLowerCase().replace(/[^a-züà-ǜ\s]/g, ' ');
    var out = [], run = '';
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (VOWEL.test(ch)) {
        // 자음 덩어리의 '끝'에서 유효한 성모를 찾는다. rènzhī → 'nzh' 의 끝은 zh
        var ini = '';
        for (var k = 0; k < INITIALS.length; k++) {
          var cand = INITIALS[k];
          if (run.length >= cand.length && run.slice(-cand.length) === cand) {
            if (cand.length > ini.length) ini = cand;
          }
        }
        out.push(ini);
        run = '';
        // 이 모음 덩어리는 통째로 건너뛴다
        while (i + 1 < s.length && VOWEL.test(s[i + 1])) i++;
      } else if (/[a-zü]/.test(ch)) {
        run += ch;
      } else {
        run = '';
      }
    }
    return out;
  }

  var ZH_GROUP = {
    zh: '권설음 zh·ch·sh·r', ch: '권설음 zh·ch·sh·r', sh: '권설음 zh·ch·sh·r', r: '권설음 zh·ch·sh·r',
    z: '설치음 z·c·s', c: '설치음 z·c·s', s: '설치음 z·c·s',
    j: '설면음 j·q·x', q: '설면음 j·q·x', x: '설면음 j·q·x'
  };
  function zhGroup(ini) { return ZH_GROUP[ini] || '그 밖의 성모'; }

  // 영어 단어에 들어 있는, 한국인이 자주 놓치는 소리
  var EN_TESTS = [
    { k: 'th (think·three)', re: /th/ },
    { k: 'v (very·value)', re: /v/ },
    { k: 'f (fee·before)', re: /f|ph/ },
    { k: 'r (right·research)', re: /r/ },
    { k: 'l (light·policy)', re: /l/ },
    { k: 'sh·ch (share·check)', re: /sh|ch/ },
    { k: 'w (work·would)', re: /w/ }
  ];
  // 일본어에서 한국인이 자주 놓치는 것 — 길이(장음·촉음)와 탁음
  var JA_TESTS = [
    { k: '장음 (おはよう·どうぞ)', re: /[ーおうえいあ]{2}|ō|ū|ā|ē|ī/ },
    { k: '촉음 (ちょっと·いっぱい)', re: /っ|tt|kk|pp|ss/ },
    { k: 'ん 한 박 (けんきゅう)', re: /ん|n[bkgmpt]|nn/ },
    { k: '탁음 (が·ざ·だ·ば)', re: /[がぎぐげござじずぜぞだぢづでどばびぶべぼ]|[gzjdb]/ },
    { k: 'つ (しつれい)', re: /つ|tsu/ },
    { k: '요음 (きょ·しゅ)', re: /[ゃゅょ]|ky|sh|ch|ny|hy|my|ry|gy|by|py/ }
  ];
  function jaKeys(word) {
    var s = String(word || '');
    var out = [];
    JA_TESTS.forEach(function (t) { if (t.re.test(s)) out.push(t.k); });
    return out;
  }

  function enKeys(word) {
    var s = String(word || '').toLowerCase();
    var out = [];
    EN_TESTS.forEach(function (t) { if (t.re.test(s)) out.push(t.k); });
    return out;
  }

  var Report = {
    BLOCK: BLOCK,
    initials: initials,

    /* ---------- 채점 결과를 소리별로 쌓기 ---------- */

    // 문장 채점(marks: 단위별 맞음/틀림)을 받아 소리별 정답·오답으로 나눠 담는다
    recordMarks: function (lang, text, phon, marks) {
      if (!marks || !marks.length) return;
      if (lang === 'zh') {
        var inis = initials(phon);
        marks.forEach(function (ok, i) {
          var g = zhGroup(inis[i] == null ? '' : inis[i]);
          w.Store.addSound(lang, g, ok);
        });
      } else if (lang === 'ja') {
        // 일본어는 띄어쓰기가 없어 글자 단위로 본다. 발음 표기(로마자)도 함께 넣어 판정한다
        var chars = String(text).split('');
        marks.forEach(function (ok, i) {
          jaKeys((chars[i] || '') + ' ' + String(phon || '')).forEach(function (k) {
            w.Store.addSound(lang, k, ok);
          });
        });
      } else {
        var words = String(text).toLowerCase().split(/[\s\-—–]+/)
          .map(function (x) { return x.replace(/[^a-z0-9']/g, ''); })
          .filter(Boolean);
        marks.forEach(function (ok, i) {
          enKeys(words[i]).forEach(function (k) { w.Store.addSound(lang, k, ok); });
        });
      }
    },

    // 성조 판정 결과를 성조별로 쌓는다 (중국어)
    recordTones: function (lang, expected, judge) {
      if (!judge) return;
      expected.forEach(function (t, i) {
        if (!t || judge.got[i] == null) return;         // 경성·판정불가 제외
        w.Store.addSound(lang, t + '성', judge.got[i] === t);
      });
    },

    /* ---------- 진단 ---------- */

    itemOf: function (cfg, day, idx) {
      for (var i = 0; i < cfg.days.length; i++) {
        if (cfg.days[i].d === day) {
          var a = cfg.days[i].items || [];
          return a[idx] || null;
        }
      }
      return null;
    },
    wordOf: function (cfg, day, idx) {
      for (var i = 0; i < cfg.days.length; i++) {
        if (cfg.days[i].d === day) {
          var a = cfg.days[i].words || [];
          return a[idx] || null;
        }
      }
      return null;
    },

    // 잘되는 것 / 안 되는 것 목록 (문장·단어를 함께 본다)
    strengths: function (lang, cfg, limit) {
      limit = limit || 6;
      var st = w.Store.state[lang], rows = [];
      Object.keys(st.scores).forEach(function (k) {
        var p = k.split('-'), it = Report.itemOf(cfg, +p[0], +p[1]);
        if (it) rows.push({ kind: '문장', day: +p[0], text: it.text, phon: it.phon, ko: it.ko, score: st.scores[k] });
      });
      Object.keys(st.words).forEach(function (k) {
        var p = k.split('-'), wd = Report.wordOf(cfg, +p[0], +p[1]), v = st.words[k];
        if (wd && v.best) rows.push({ kind: '단어', day: +p[0], text: wd.text, phon: wd.phon, ko: wd.ko, score: v.best });
      });
      rows.sort(function (a, b) { return b.score - a.score; });
      return {
        good: rows.filter(function (r) { return r.score >= 85; }).slice(0, limit),
        bad: rows.filter(function (r) { return r.score < 70; })
                 .sort(function (a, b) { return a.score - b.score; }).slice(0, limit),
        total: rows.length
      };
    },

    // 소리별 정답률 (낮은 순)
    sounds: function (lang) {
      var s = w.Store.state[lang].sounds, out = [];
      Object.keys(s).forEach(function (k) {
        var v = s[k], n = v.ok + v.no;
        if (n < 4) return;                       // 표본이 너무 적으면 판단하지 않는다
        out.push({ key: k, rate: Math.round(v.ok / n * 100), n: n });
      });
      out.sort(function (a, b) { return a.rate - b.rate; });
      return out;
    },

    /* ---------- 7회차 주기 평가 ---------- */

    blockOf: function (day) { return Math.ceil(day / BLOCK); },
    blockRange: function (b) { return { from: (b - 1) * BLOCK + 1, to: b * BLOCK }; },

    // 한 구간(7회차)의 성적을 계산한다. 완료 여부와 무관하게 있는 자료로만 낸다.
    blockStats: function (lang, cfg, b) {
      var r = this.blockRange(b), st = w.Store.state[lang];
      var sum = 0, cnt = 0, wsum = 0, wcnt = 0, reps = 0, need = 0;
      var tHit = 0, tJudged = 0, tk = 0, tOk = 0, tSkip = 0, doneN = 0;

      for (var d = r.from; d <= Math.min(r.to, cfg.meta.days); d++) {
        var day = null;
        for (var i = 0; i < cfg.days.length; i++) if (cfg.days[i].d === d) day = cfg.days[i];
        if (!day) continue;
        if (w.Store.isDone(lang, d)) doneN++;

        (day.items || []).forEach(function (_it, idx) {
          var v = st.scores[d + '-' + idx];
          if (v != null) { sum += v; cnt++; }
          var tn = st.tones[d + '-' + idx];
          if (tn) { tHit += tn.hit; tJudged += tn.judged; }
        });
        (day.words || []).forEach(function (_wd, idx) {
          var v = st.words[d + '-' + idx];
          need += w.Store.REPS;
          if (v) {
            reps += Math.min(w.Store.REPS, v.reps);
            if (v.best) { wsum += v.best; wcnt++; }
          }
        });
        var tk1 = st.talk[String(d)];
        if (tk1) { tk += tk1.turns; tOk += tk1.ok; tSkip += tk1.skip; }
      }

      return {
        block: b, from: r.from, to: r.to, doneN: doneN,
        sentAvg: cnt ? Math.round(sum / cnt) : null, sentN: cnt,
        wordAvg: wcnt ? Math.round(wsum / wcnt) : null, wordN: wcnt,
        reps: reps, need: need,
        toneRate: tJudged ? Math.round(tHit / tJudged * 100) : null, toneN: tJudged,
        talkRate: tk ? Math.round(tOk / tk * 100) : null, talkN: tk, talkSkip: tSkip,
        has: cnt > 0 || wcnt > 0 || tk > 0
      };
    },

    // 발음 등급 — 문장·단어 점수를 합쳐 본다
    grade: function (s) {
      var vals = [], wts = [];
      if (s.sentAvg != null) { vals.push(s.sentAvg); wts.push(2); }
      if (s.wordAvg != null) { vals.push(s.wordAvg); wts.push(1); }
      if (!vals.length) return null;
      var num = 0, den = 0;
      vals.forEach(function (v, i) { num += v * wts[i]; den += wts[i]; });
      var score = Math.round(num / den);
      var g = score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'E';
      var label = { A: '원어민이 바로 알아듣는 수준', B: '대체로 통하는 수준',
                    C: '천천히 말하면 통하는 수준', D: '되묻게 만드는 수준',
                    E: '아직 소리가 잡히지 않은 단계' }[g];
      return { score: score, grade: g, label: label };
    },

    // 대화 수준 1~5 — 내 차례를 몇 번이나 스스로 통과했는가
    talkLevel: function (s) {
      if (s.talkRate == null || s.talkN < 3) return null;
      var r = s.talkRate, skipRate = s.talkN ? s.talkSkip / s.talkN : 0;
      var lv = r >= 90 ? 5 : r >= 75 ? 4 : r >= 60 ? 3 : r >= 40 ? 2 : 1;
      if (skipRate > 0.3 && lv > 1) lv -= 1;      // 건너뛰기가 잦으면 한 단계 내린다
      var label = {
        5: '대화를 끌고 갈 수 있음 — 상대 속도에 맞춰 주고받음',
        4: '준비된 상황이면 무리 없음 — 예상 밖 질문에서 흔들림',
        3: '한 번씩 되묻지만 대화가 끊기지 않음',
        2: '단문 위주 — 문장이 길어지면 막힘',
        1: '아직 문장을 통째로 외워 말하는 단계'
      }[lv];
      return { level: lv, rate: r, label: label };
    },

    // 지금까지의 모든 구간을 계산하고, 자료가 있는 구간은 저장해 둔다
    allBlocks: function (lang, cfg) {
      var out = [], last = Math.ceil(cfg.meta.days / BLOCK);
      for (var b = 1; b <= last; b++) {
        var s = this.blockStats(lang, cfg, b);
        if (!s.has) continue;
        s.gradeInfo = this.grade(s);
        s.talkInfo = this.talkLevel(s);
        out.push(s);
        // 구간의 7회차를 모두 마쳤으면 그때 성적을 확정해 남긴다
        if (s.doneN >= Math.min(BLOCK, cfg.meta.days - s.from + 1)) {
          w.Store.putReport(lang, b, {
            sentAvg: s.sentAvg, wordAvg: s.wordAvg, toneRate: s.toneRate,
            talkRate: s.talkRate, grade: s.gradeInfo && s.gradeInfo.grade,
            score: s.gradeInfo && s.gradeInfo.score,
            level: s.talkInfo && s.talkInfo.level,
            savedAt: w.Store.todayStr()
          });
        }
      }
      return out;
    },

    // 구간 사이의 변화 — 좋아졌는지 나빠졌는지
    delta: function (blocks, key) {
      var vals = blocks.map(function (b) { return b[key]; }).filter(function (v) { return v != null; });
      if (vals.length < 2) return null;
      return vals[vals.length - 1] - vals[vals.length - 2];
    }
  };

  w.Report = Report;
})(window);
