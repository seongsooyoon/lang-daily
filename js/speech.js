/* 듣기(음성합성) · 말하기(음성인식) · 채점
 *
 * 채점은 "내가 말한 것을 브라우저가 무엇으로 알아들었는가"를 정답과 대조하는 방식이다.
 * 원어민 수준의 성조·억양 정밀 평가가 아니라 '말이 통하는가'를 재는 실용 지표다.
 */
(function (w) {
  'use strict';

  // 'zh' 도 'zh2'(2차) 도 'zh-CN' 도 중국어다. 차수는 저장 키일 뿐 언어 판정과 무관하다.
  function isZh(L) { return String(L).slice(0, 2) === 'zh'; }

  var SR = w.SpeechRecognition || w.webkitSpeechRecognition || null;

  var Speech = {
    /* ---------- 듣기 ---------- */
    voicesReady: false,
    _voices: [],

    initVoices: function (cb) {
      var self = this;
      function load() {
        self._voices = w.speechSynthesis ? w.speechSynthesis.getVoices() : [];
        if (self._voices.length) { self.voicesReady = true; if (cb) cb(); }
      }
      if (!w.speechSynthesis) { if (cb) cb(); return; }
      load();
      // 크롬은 목록이 비동기로 채워진다
      w.speechSynthesis.onvoiceschanged = load;
      setTimeout(load, 400);
    },

    pickVoice: function (bcp) {
      if (!this._voices.length && w.speechSynthesis) this._voices = w.speechSynthesis.getVoices();
      var want = bcp.toLowerCase(), base = want.split('-')[0];
      var exact = null, loose = null;
      for (var i = 0; i < this._voices.length; i++) {
        var v = this._voices[i], lg = (v.lang || '').toLowerCase().replace('_', '-');
        if (lg === want && !exact) exact = v;
        if (lg.split('-')[0] === base && !loose) loose = v;
      }
      return exact || loose || null;
    },

    hasVoice: function (bcp) { return !!this.pickVoice(bcp); },

    speak: function (text, bcp, rate, done) {
      if (!w.speechSynthesis) { if (done) done(new Error('nosynth')); return; }
      try { w.speechSynthesis.cancel(); } catch (e) {}
      var u = new SpeechSynthesisUtterance(text);
      u.lang = bcp;
      u.rate = rate || 0.8;
      u.pitch = 1;
      var v = this.pickVoice(bcp);
      if (v) u.voice = v;
      if (done) { u.onend = function () { done(null); }; u.onerror = function () { done(new Error('speak')); }; }
      w.speechSynthesis.speak(u);
    },

    stop: function () { try { w.speechSynthesis.cancel(); } catch (e) {} },

    /* ---------- 말하기 ---------- */
    canListen: function () { return !!SR; },

    _rec: null,
    listening: false,

    listen: function (bcp, onResult, onError) {
      if (!SR) { onError && onError('unsupported'); return null; }
      this.abort();
      var r = new SR();
      r.lang = bcp;
      r.interimResults = false;
      r.maxAlternatives = 3;
      r.continuous = false;
      var self = this, settled = false;

      r.onresult = function (ev) {
        settled = true;
        var alts = [];
        for (var i = 0; i < ev.results[0].length; i++) alts.push(ev.results[0][i].transcript);
        onResult && onResult(alts);
      };
      r.onerror = function (ev) {
        settled = true;
        onError && onError(ev.error || 'error');
      };
      r.onend = function () {
        self.listening = false;
        self._rec = null;
        if (!settled) onError && onError('no-speech');
      };
      try { r.start(); this.listening = true; this._rec = r; }
      catch (e) { onError && onError('start-failed'); }
      return r;
    },

    abort: function () {
      if (this._rec) { try { this._rec.abort(); } catch (e) {} this._rec = null; }
      this.listening = false;
    },

    errorText: function (code) {
      return ({
        'unsupported': '이 브라우저는 음성인식을 지원하지 않습니다. 크롬으로 열어주십시오.',
        'not-allowed': '마이크 권한이 거부됐습니다. 주소창 자물쇠 → 마이크 허용으로 바꿔주십시오.',
        'service-not-allowed': '마이크 권한이 막혀 있습니다. 브라우저 설정을 확인해 주십시오.',
        'no-speech': '소리가 잡히지 않았습니다. 마이크에 가까이 대고 다시 말씀해 주십시오.',
        'audio-capture': '마이크를 찾지 못했습니다. 연결 상태를 확인해 주십시오.',
        'network': '음성인식은 인터넷 연결이 필요합니다. 연결을 확인해 주십시오.',
        'aborted': '인식이 중단됐습니다.',
        'start-failed': '마이크를 시작하지 못했습니다. 잠시 후 다시 눌러주십시오.'
      })[code] || ('인식에 실패했습니다 (' + code + ')');
    },

    /* ---------- 채점 ---------- */

    // 비교 단위로 자른다. 중국어는 한자 1글자, 영어는 단어.
    tokenize: function (s, lang) {
      if (isZh(lang)) {
        var m = String(s).match(/[㐀-鿿豈-﫿]/g);
        return m || [];
      }
      return String(s).toLowerCase()
        .replace(/[‘’]/g, "'")
        .replace(/[^a-z0-9']+/g, ' ')
        .trim().split(/\s+/).filter(Boolean);
    },

    // 영어에서 인식기가 흔히 다르게 쓰는 것들 — 발음이 맞았는데 틀렸다고 나오면 억울하다.
    _enNorm: function (t) {
      // 축약형은 풀어서 비교한다. 인식기가 "I'm"으로 쓰든 "I am"으로 쓰든
      // 대표님이 같은 소리를 냈다면 같은 점수가 나와야 한다.
      var expand = {
        "i'm": 'i am', "it's": 'it is', "that's": 'that is', "what's": 'what is',
        "here's": 'here is', "there's": 'there is', "let's": 'let us',
        "don't": 'do not', "doesn't": 'does not', "didn't": 'did not',
        "can't": 'can not', "won't": 'will not', "isn't": 'is not', "aren't": 'are not',
        "wasn't": 'was not', "weren't": 'were not', "haven't": 'have not',
        "hasn't": 'has not', "hadn't": 'had not', "shouldn't": 'should not',
        "wouldn't": 'would not', "couldn't": 'could not',
        "i'd": 'i would', "i'll": 'i will', "i've": 'i have',
        "we're": 'we are', "we'll": 'we will', "we've": 'we have', "we'd": 'we would',
        "you're": 'you are', "you'll": 'you will', "you've": 'you have',
        "they're": 'they are', "they'll": 'they will', "they've": 'they have',
        "he's": 'he is', "she's": 'she is', "who's": 'who is',
        'ok': 'okay', 'mr': 'mister', 'mrs': 'missus', 'ms': 'miss',
        // 인식기는 숫자를 자릿수로 적기도 하고 글자로 적기도 한다. 한쪽으로 통일한다.
        '1': 'one', '2': 'two', '3': 'three', '4': 'four', '5': 'five',
        '6': 'six', '7': 'seven', '8': 'eight', '9': 'nine', '10': 'ten',
        '11': 'eleven', '12': 'twelve', '13': 'thirteen', '14': 'fourteen',
        '15': 'fifteen', '16': 'sixteen', '17': 'seventeen', '18': 'eighteen',
        '19': 'nineteen', '20': 'twenty', '30': 'thirty', '40': 'forty',
        '50': 'fifty', '60': 'sixty', '70': 'seventy', '80': 'eighty',
        '90': 'ninety', '100': 'hundred', '1000': 'thousand'
      };
      var e = expand[t];
      return e ? e.split(' ') : [t.replace(/'/g, '')];
    },

    // 화면에 보여 줄 단위(중국어=글자, 영어=단어)와 비교용 토큰을 함께 만든다.
    // 영어는 한 단어가 두 토큰으로 풀릴 수 있어(I'm → i am) 둘을 분리해 둔다.
    groups: function (s, lang) {
      var out = [];
      if (isZh(lang)) {
        (this.tokenize(s, lang)).forEach(function (ch) { out.push([ch]); });
        return out;
      }
      var self = this;
      // 하이픈은 띄어쓰기로 본다. twenty-minute를 인식기는 "twenty minute"로 적는다.
      // markup() 도 같은 경계로 쪼개야 색이 밀리지 않는다.
      String(s).toLowerCase().replace(/[‘’]/g, "'").split(/[\s\-—–]+/).forEach(function (w) {
        var clean = w.replace(/[^a-z0-9']+/g, '');
        if (!clean) return;
        out.push(self._enNorm(clean));
      });
      return out;
    },

    // 편집거리 정렬 → 정답 토큰마다 맞음/틀림 표시
    align: function (exp, got) {
      var n = exp.length, m = got.length;
      var d = [], i, j;
      for (i = 0; i <= n; i++) { d.push(new Array(m + 1)); d[i][0] = i; }
      for (j = 0; j <= m; j++) d[0][j] = j;
      for (i = 1; i <= n; i++)
        for (j = 1; j <= m; j++)
          d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1,
                             d[i - 1][j - 1] + (exp[i - 1] === got[j - 1] ? 0 : 1));
      // 되짚어가며 정답 각 토큰이 맞았는지 표시
      var marks = new Array(n).fill(false);
      i = n; j = m;
      while (i > 0 && j > 0) {
        if (exp[i - 1] === got[j - 1] && d[i][j] === d[i - 1][j - 1]) { marks[i - 1] = true; i--; j--; }
        else if (d[i][j] === d[i - 1][j - 1] + 1) { i--; j--; }
        else if (d[i][j] === d[i - 1][j] + 1) { i--; }
        else { j--; }
      }
      return { dist: d[n][m], marks: marks };
    },

    // 여러 후보 중 가장 잘 맞은 것으로 채점 (인식기가 1순위를 틀리는 일이 잦다)
    score: function (expected, alternatives, lang) {
      var expG = this.groups(expected, lang);
      if (!expG.length) return { score: 0, marks: [], heard: '', exp: [] };

      // 그룹을 펼쳐 비교하되, 어느 그룹에서 나온 토큰인지 기억해 둔다
      var expFlat = [], owner = [];
      expG.forEach(function (g, gi) {
        g.forEach(function (t) { expFlat.push(t); owner.push(gi); });
      });

      var best = null;
      (alternatives || []).forEach(function (alt) {
        var gotFlat = [];
        this.groups(alt, lang).forEach(function (g) { gotFlat = gotFlat.concat(g); });
        var a = this.align(expFlat, gotFlat);
        var sc = Math.max(0, Math.round(
          (1 - a.dist / Math.max(expFlat.length, gotFlat.length || 1)) * 100));
        if (best && sc <= best.score) return;
        // 그룹 안의 토큰이 모두 맞아야 그 단어를 맞은 것으로 본다
        var marks = expG.map(function () { return true; });
        a.marks.forEach(function (ok, i) { if (!ok) marks[owner[i]] = false; });
        best = { score: sc, marks: marks, heard: alt, exp: expFlat };
      }, this);

      return best || {
        score: 0, marks: expG.map(function () { return false; }), heard: '', exp: expFlat
      };
    },

    // 원문에 맞음/틀림 색을 입힌 HTML
    markup: function (expected, marks, lang) {
      var out = '', k = 0, s = String(expected);
      if (isZh(lang)) {
        for (var i = 0; i < s.length; i++) {
          var ch = s[i];
          if (/[㐀-鿿豈-﫿]/.test(ch)) {
            out += '<span class="' + (marks[k] ? 'ch-ok' : 'ch-no') + '">' + ch + '</span>';
            k++;
          } else out += ch;
        }
        return out;
      }
      // groups() 와 같은 경계(공백 + 하이픈)로 쪼개야 표시가 한 칸씩 밀리지 않는다
      var parts = s.split(/([\s\-—–]+)/);
      return parts.map(function (p) {
        if (/^[\s\-—–]+$/.test(p) || !/[a-zA-Z0-9]/.test(p)) return p;
        var cls = marks[k] ? 'ch-ok' : 'ch-no'; k++;
        return '<span class="' + cls + '">' + p + '</span>';
      }).join('');
    }
  };

  w.Speech = Speech;
})(window);
