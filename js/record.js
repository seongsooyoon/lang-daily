/* 내 발음 녹음 · 원어민과 번갈아 듣기 · 음높이(성조)/강세 곡선
 *
 * 음성인식 채점(speech.js)은 "무슨 말로 들렸는가"만 본다.
 * 성조가 틀려도 글자가 맞게 인식되는 일이 있어서, 그것만으로는 발음이 맞았는지 알 수 없다.
 * 그래서 여기서는 실제 목소리를 녹음해 ①귀로 비교하고 ②음높이 곡선을 눈으로 비교한다.
 */
(function (w) {
  'use strict';

  var Rec = {
    stream: null, mr: null, chunks: [], recording: false, lastUrl: null,

    supported: function () {
      return !!(w.navigator && w.navigator.mediaDevices &&
                w.navigator.mediaDevices.getUserMedia && w.MediaRecorder);
    },

    start: function (onReady, onError) {
      var self = this;
      if (!this.supported()) { onError && onError('unsupported'); return; }
      w.navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      }).then(function (stream) {
        self.stream = stream;
        self.chunks = [];
        var mime = '';
        ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].some(function (m) {
          if (w.MediaRecorder.isTypeSupported && w.MediaRecorder.isTypeSupported(m)) { mime = m; return true; }
          return false;
        });
        self.mr = mime ? new w.MediaRecorder(stream, { mimeType: mime }) : new w.MediaRecorder(stream);
        self.mr.ondataavailable = function (e) { if (e.data && e.data.size) self.chunks.push(e.data); };
        self.mr.start();
        self.recording = true;
        onReady && onReady();
      }).catch(function (e) {
        onError && onError(e && e.name === 'NotAllowedError' ? 'not-allowed' : 'mic-failed');
      });
    },

    stop: function (done) {
      var self = this;
      if (!this.mr || !this.recording) { done && done(null); return; }
      this.mr.onstop = function () {
        self.recording = false;
        if (self.stream) { self.stream.getTracks().forEach(function (t) { t.stop(); }); self.stream = null; }
        var blob = new Blob(self.chunks, { type: (self.mr && self.mr.mimeType) || 'audio/webm' });
        // 이전 녹음의 주소는 지우지 않는다 — 다른 문장 카드에서 아직 다시 들을 수 있어야 한다
        self.lastUrl = URL.createObjectURL(blob);
        done && done({ blob: blob, url: self.lastUrl });
      };
      try { this.mr.stop(); } catch (e) { this.recording = false; done && done(null); }
    },

    cancel: function () {
      if (this.stream) { this.stream.getTracks().forEach(function (t) { t.stop(); }); this.stream = null; }
      this.recording = false; this.mr = null; this.chunks = [];
    },

    errorText: function (code) {
      return ({
        'unsupported': '이 브라우저는 녹음을 지원하지 않습니다. 크롬으로 열어주십시오.',
        'not-allowed': '마이크 권한이 거부됐습니다. 주소창 자물쇠 → 마이크 허용으로 바꿔주십시오.',
        'mic-failed': '마이크를 시작하지 못했습니다. 다른 프로그램이 쓰고 있는지 확인해 주십시오.'
      })[code] || '녹음에 실패했습니다.';
    },

    /* ---------- 소리 분석 ---------- */

    // 녹음을 풀어 음높이(Hz)와 세기(RMS)를 시간순으로 뽑는다.
    analyze: function (blob) {
      var AC = w.AudioContext || w.webkitAudioContext;
      if (!AC) return Promise.resolve(null);
      var ctx = new AC();
      return blob.arrayBuffer()
        .then(function (buf) { return ctx.decodeAudioData(buf); })
        .then(function (audio) {
          var sr = audio.sampleRate;
          var x = audio.getChannelData(0);
          var win = Math.round(sr * 0.045);        // 45ms — 70Hz도 두 주기가 들어간다
          var hop = Math.round(sr * 0.012);        // 12ms
          var minLag = Math.floor(sr / 350), maxLag = Math.floor(sr / 70);
          var frames = [];
          for (var s = 0; s + win < x.length; s += hop) {
            frames.push(pitchAt(x, s, win, minLag, maxLag, sr));
          }
          try { ctx.close(); } catch (e) {}
          return smooth(frames, audio.duration);
        })
        .catch(function () { try { ctx.close(); } catch (e) {} return null; });
    }
  };

  // 한 프레임의 음높이 — 정규화 자기상관
  function pitchAt(x, s, win, minLag, maxLag, sr) {
    var i, sum = 0;
    for (i = 0; i < win; i++) sum += x[s + i] * x[s + i];
    var rms = Math.sqrt(sum / win);
    if (rms < 0.008) return { hz: 0, rms: rms };   // 무음·잡음

    var bestLag = 0, bestVal = 0;
    for (var lag = minLag; lag <= maxLag && s + win + lag < x.length; lag++) {
      var num = 0, den1 = 0, den2 = 0;
      for (i = 0; i < win; i += 2) {               // 2칸씩 건너뛰어도 충분하고 빠르다
        var a = x[s + i], b = x[s + i + lag];
        num += a * b; den1 += a * a; den2 += b * b;
      }
      var v = num / (Math.sqrt(den1 * den2) + 1e-9);
      if (v > bestVal) { bestVal = v; bestLag = lag; }
    }
    if (bestVal < 0.55 || !bestLag) return { hz: 0, rms: rms };
    return { hz: sr / bestLag, rms: rms };
  }

  // 튀는 값 정리 + 반음 단위로 환산
  function smooth(frames, dur) {
    var hz = frames.map(function (f) { return f.hz; });
    var out = [];
    for (var i = 0; i < hz.length; i++) {
      var a = hz[Math.max(0, i - 1)], b = hz[i], c = hz[Math.min(hz.length - 1, i + 1)];
      var v = [a, b, c].filter(function (n) { return n > 0; }).sort(function (p, q) { return p - q; });
      out.push(v.length ? v[Math.floor(v.length / 2)] : 0);
    }
    var voiced = out.filter(function (n) { return n > 0; }).sort(function (p, q) { return p - q; });
    var med = voiced.length ? voiced[Math.floor(voiced.length / 2)] : 0;
    return {
      dur: dur,
      med: med,
      rms: frames.map(function (f) { return f.rms; }),
      // 반음: 중앙값을 0으로 두고 위아래 몇 반음인지
      st: out.map(function (n) { return n > 0 ? 12 * Math.log2(n / med) : null; }),
      voicedRatio: voiced.length / (out.length || 1)
    };
  }

  /* ---------- 중국어 성조 ---------- */

  var TONE_MARK = {
    'ā': 1, 'ē': 1, 'ī': 1, 'ō': 1, 'ū': 1, 'ǖ': 1,
    'á': 2, 'é': 2, 'í': 2, 'ó': 2, 'ú': 2, 'ǘ': 2,
    'ǎ': 3, 'ě': 3, 'ǐ': 3, 'ǒ': 3, 'ǔ': 3, 'ǚ': 3,
    'à': 4, 'è': 4, 'ì': 4, 'ò': 4, 'ù': 4, 'ǜ': 4
  };
  var VOWEL = /[aeiouüvāēīōūǖáéíóúǘǎěǐǒǔǚàèìòùǜ]/i;

  // 병음에서 음절별 성조를 뽑는다. 성조 부호가 없으면 경성(0).
  Rec.tones = function (pinyin) {
    var s = String(pinyin || '').replace(/[^A-Za-zāēīōūǖáéíóúǘǎěǐǒǔǚàèìòùǜüv]/g, ' ');
    var out = [], cur = null;
    for (var i = 0; i < s.length; i++) {
      var ch = s[i], isV = VOWEL.test(ch);
      if (isV) {
        if (cur === null) cur = 0;
        var t = TONE_MARK[ch.toLowerCase()];
        if (t) cur = t;
      } else if (cur !== null) {
        out.push(cur); cur = null;
      }
    }
    if (cur !== null) out.push(cur);
    return out;
  };

  // 성조별 이상적인 음높이 모양 (조치 1~5를 반음으로 옮긴 값)
  var SHAPE = {
    1: [4, 4, 4],        // 55  높고 평평
    2: [-1, 1, 4],       // 35  올림
    3: [-2, -5, -1],     // 214 내렸다 살짝 올림
    4: [5, 0, -5],       // 51  뚝 떨어뜨림
    0: [0, 0, 0]         // 경성 — 짧고 가볍게
  };
  Rec.shape = function (t) { return SHAPE[t] || SHAPE[0]; };

  Rec.toneName = function (t) {
    return ({ 1: '1성 평평', 2: '2성 올림', 3: '3성 내렸다올림', 4: '4성 떨어뜨림', 0: '경성' })[t] || '';
  };

  // 소리 난 구간을 음절 수만큼 균등하게 나눠, 각 음절의 실제 모양을 재고 성조를 추정한다.
  Rec.judgeTones = function (an, expected) {
    if (!an || !expected.length) return null;
    var st = an.st;
    var first = st.findIndex(function (v) { return v !== null; });
    var last = st.length - 1 - st.slice().reverse().findIndex(function (v) { return v !== null; });
    if (first < 0 || last <= first) return null;

    var span = last - first + 1;
    var per = span / expected.length;
    var got = [], detail = [];
    for (var k = 0; k < expected.length; k++) {
      var a = first + Math.round(k * per), b = first + Math.round((k + 1) * per);
      var seg = st.slice(a, b).filter(function (v) { return v !== null; });
      if (seg.length < 3) { got.push(null); detail.push(null); continue; }
      var head = avg(seg.slice(0, Math.max(1, Math.round(seg.length / 3))));
      var tail = avg(seg.slice(-Math.max(1, Math.round(seg.length / 3))));
      var mid = avg(seg.slice(Math.round(seg.length / 3), Math.round(seg.length * 2 / 3)));
      var slope = tail - head;
      var t;
      if (mid < head - 1.2 && mid < tail - 1.2) t = 3;
      else if (slope > 1.6) t = 2;
      else if (slope < -1.6) t = 4;
      else t = 1;
      got.push(t);
      detail.push({ head: head, mid: mid, tail: tail, slope: slope, seg: seg, a: a, b: b });
    }
    var hit = 0, judged = 0;
    expected.forEach(function (e, i) {
      if (got[i] === null || e === 0) return;       // 경성은 판정에서 뺀다
      judged++;
      if (got[i] === e) hit++;
    });
    return { got: got, detail: detail, hit: hit, judged: judged, first: first, last: last };
  };

  function avg(a) { return a.reduce(function (s, v) { return s + v; }, 0) / (a.length || 1); }

  /* ---------- 그리기 ---------- */

  // 중국어: 내 음높이 곡선 + 성조가 그려야 할 모양
  Rec.drawTones = function (canvas, an, expected, judge) {
    var g = canvas.getContext('2d');
    var dpr = canvas._dpr || 1;                       // 화면 배율은 showRec 에서 걸어 둔다
    var W = canvas.width / dpr, H = canvas.height / dpr;
    var css = getComputedStyle(document.body);
    var line = css.getPropertyValue('--line') || '#E2DCD0';
    var ink = css.getPropertyValue('--ink') || '#1E3A5F';
    var brick = css.getPropertyValue('--brick') || '#B4623A';
    var dim = css.getPropertyValue('--dim') || '#6B7280';
    g.clearRect(0, 0, W, H);

    var pad = 18, top = 10, bot = H - 18;
    var y = function (semi) {
      var s = Math.max(-9, Math.min(9, semi));
      return top + (1 - (s + 9) / 18) * (bot - top);
    };

    // 가로 기준선
    g.strokeStyle = line; g.lineWidth = 1;
    [-6, 0, 6].forEach(function (s) {
      g.beginPath(); g.moveTo(pad, y(s)); g.lineTo(W - pad, y(s)); g.stroke();
    });

    if (!an || !judge) {
      g.fillStyle = dim; g.font = '12px sans-serif'; g.textAlign = 'center';
      g.fillText('소리가 충분히 잡히지 않았습니다', W / 2, H / 2);
      return;
    }

    var n = expected.length;
    var slotW = (W - pad * 2) / n;

    // 음절 칸막이 + 기대 모양(점선)
    expected.forEach(function (t, i) {
      var x0 = pad + slotW * i, x1 = x0 + slotW;
      if (i) { g.strokeStyle = line; g.beginPath(); g.moveTo(x0, top); g.lineTo(x0, bot); g.stroke(); }
      var sh = Rec.shape(t);
      g.strokeStyle = brick; g.lineWidth = 2; g.setLineDash([4, 3]);
      g.beginPath();
      sh.forEach(function (s, k) {
        var xx = x0 + slotW * (0.18 + 0.64 * (k / (sh.length - 1)));
        if (k) g.lineTo(xx, y(s)); else g.moveTo(xx, y(s));
      });
      g.stroke(); g.setLineDash([]);
      // 맞았는지 표시
      var okMark = (t === 0) ? '·' : (judge.got[i] === t ? '○' : '✕');
      g.fillStyle = (t === 0) ? dim : (judge.got[i] === t ? '#2F7D5B' : '#B03A3A');
      g.font = 'bold 13px sans-serif'; g.textAlign = 'center';
      g.fillText(okMark, (x0 + x1) / 2, H - 4);
    });

    // 내 음높이 곡선
    g.strokeStyle = ink; g.lineWidth = 2.4; g.lineJoin = 'round';
    var span = judge.last - judge.first + 1;
    g.beginPath();
    var started = false;
    for (var i2 = judge.first; i2 <= judge.last; i2++) {
      var v = an.st[i2];
      var xx2 = pad + ((i2 - judge.first) / span) * (W - pad * 2);
      if (v === null) { started = false; continue; }
      if (started) g.lineTo(xx2, y(v)); else { g.moveTo(xx2, y(v)); started = true; }
    }
    g.stroke();
  };

  // 영어: 세기(강세) 곡선
  Rec.drawStress = function (canvas, an) {
    var g = canvas.getContext('2d');
    var dpr = canvas._dpr || 1;
    var W = canvas.width / dpr, H = canvas.height / dpr;
    var css = getComputedStyle(document.body);
    var line = css.getPropertyValue('--line') || '#E2DCD0';
    var ink = css.getPropertyValue('--ink') || '#1E3A5F';
    var dim = css.getPropertyValue('--dim') || '#6B7280';
    g.clearRect(0, 0, W, H);
    var pad = 18, top = 10, bot = H - 14;
    g.strokeStyle = line; g.lineWidth = 1;
    g.beginPath(); g.moveTo(pad, bot); g.lineTo(W - pad, bot); g.stroke();

    if (!an || !an.rms.length) {
      g.fillStyle = dim; g.font = '12px sans-serif'; g.textAlign = 'center';
      g.fillText('소리가 충분히 잡히지 않았습니다', W / 2, H / 2);
      return;
    }
    var max = Math.max.apply(null, an.rms) || 1;
    g.fillStyle = ink; g.globalAlpha = 0.85;
    g.beginPath(); g.moveTo(pad, bot);
    an.rms.forEach(function (v, i) {
      var xx = pad + (i / (an.rms.length - 1)) * (W - pad * 2);
      g.lineTo(xx, bot - (v / max) * (bot - top));
    });
    g.lineTo(W - pad, bot); g.closePath(); g.fill(); g.globalAlpha = 1;
  };

  w.Rec = Rec;
})(window);
