/* 보스턴 발음 판정 — r을 흘렸는가(non-rhotic), 발음했는가(rhotic)
 *
 * 왜 이렇게 재는가
 *   미국 표준식 r 을 내면 제3포먼트(F3)가 2500Hz 언저리에서 1600Hz 아래로 뚝 떨어진다.
 *   r 을 흘리면(보스턴식) F3 가 높은 자리에 그대로 남는다. 이것이 음성학에서 쓰는 표지다.
 *   포먼트를 하나하나 집어내는 건 잡음에 약해서, 여기서는 더 튼튼한 방법을 쓴다 —
 *   **낮은 띠(1300~2000Hz)와 높은 띠(2300~3200Hz)의 에너지 비**를 본다.
 *   r 을 내면 F3 가 낮은 띠로 내려오므로 이 비가 확 커진다.
 *
 * 정직하게 : 이 판정은 r 계열에만 쓴다. broad a·t 목구멍소리는 자동 판정하지 않고
 *            녹음을 나란히 들려주는 데서 멈춘다(신뢰할 만큼 재지 못하기 때문).
 */
(function (w) {
  'use strict';

  /* ---------- FFT (radix-2) ---------- */

  function fft(re, im) {
    var n = re.length, i, j = 0, k, m, t;
    for (i = 0; i < n - 1; i++) {
      if (i < j) { t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
      k = n >> 1;
      while (k <= j) { j -= k; k >>= 1; }
      j += k;
    }
    for (m = 2; m <= n; m <<= 1) {
      var ang = -2 * Math.PI / m, wr = Math.cos(ang), wi = Math.sin(ang);
      for (i = 0; i < n; i += m) {
        var cr = 1, ci = 0;
        for (k = 0; k < m / 2; k++) {
          var ar = re[i + k], ai = im[i + k];
          var br = re[i + k + m / 2] * cr - im[i + k + m / 2] * ci;
          var bi = re[i + k + m / 2] * ci + im[i + k + m / 2] * cr;
          re[i + k] = ar + br; im[i + k] = ai + bi;
          re[i + k + m / 2] = ar - br; im[i + k + m / 2] = ai - bi;
          var nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
        }
      }
    }
  }

  var N = 2048;
  var hann = null;
  function window_() {
    if (hann) return hann;
    hann = new Float32Array(N);
    for (var i = 0; i < N; i++) hann[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
    return hann;
  }

  function bandEnergy(mag, sr, lo, hi) {
    var a = Math.round(lo / (sr / N)), b = Math.round(hi / (sr / N));
    var s = 0;
    for (var i = a; i <= b && i < mag.length; i++) s += mag[i] * mag[i];
    return s;
  }

  var Rhotic = {
    LOW: [1250, 2050],        // r 을 내면 F3 가 내려오는 자리
    HIGH: [2350, 3250],       // r 을 안 내면 F3 가 남아 있는 자리

    // 녹음을 프레임마다 훑어 '낮은 띠 / 높은 띠' 에너지 비를 뽑는다
    analyze: function (blob) {
      var AC = w.AudioContext || w.webkitAudioContext;
      if (!AC) return Promise.resolve(null);
      var ctx = new AC();
      return blob.arrayBuffer()
        .then(function (b) { return ctx.decodeAudioData(b); })
        .then(function (audio) {
          var sr = audio.sampleRate, x = audio.getChannelData(0);
          var hop = Math.round(sr * 0.010);
          var win = window_();
          var frames = [];
          for (var s = 0; s + N < x.length; s += hop) {
            var re = new Float64Array(N), im = new Float64Array(N), e = 0;
            for (var i = 0; i < N; i++) { var v = x[s + i]; re[i] = v * win[i]; e += v * v; }
            var rms = Math.sqrt(e / N);
            if (rms < 0.01) { frames.push({ t: s / sr, rms: rms, ratio: null }); continue; }
            fft(re, im);
            var half = N / 2, mag = new Float64Array(half);
            for (var q = 0; q < half; q++) mag[q] = Math.sqrt(re[q] * re[q] + im[q] * im[q]);
            var lo = bandEnergy(mag, sr, Rhotic.LOW[0], Rhotic.LOW[1]);
            var hi = bandEnergy(mag, sr, Rhotic.HIGH[0], Rhotic.HIGH[1]);
            frames.push({ t: s / sr, rms: rms, ratio: (lo + 1e-12) / (hi + 1e-12) });
          }
          try { ctx.close(); } catch (err) {}
          return { sr: sr, dur: audio.duration, frames: frames };
        })
        .catch(function () { try { ctx.close(); } catch (err) {} return null; });
    },

    // 소리가 난 구간만 남긴다
    voiced: function (an) {
      if (!an) return [];
      var f = an.frames.filter(function (x) { return x.ratio != null; });
      if (!f.length) return [];
      var peak = Math.max.apply(null, f.map(function (x) { return x.rms; }));
      return f.filter(function (x) { return x.rms > peak * 0.25; });
    },

    /* ---------- 판정 ----------
     * expectRhotic=false : 보스턴식이면 r 을 흘려야 한다 (car, park, better …)
     * expectRhotic=true  : 연결 r 은 오히려 살려야 한다 (far away, more of it)
     */
    // mode 'tail' : car·better 처럼 r 이 단어 끝에 오는 경우
    // mode 'mid'  : far away 처럼 r 이 두 단어 사이에서 살아나는 경우
    ZONE: { tail: { core: [0.15, 0.60], target: [0.62, 1.00] },
            mid:  { core: [0.06, 0.26], target: [0.30, 0.58] } },

    judge: function (an, expectRhotic, mode) {
      var v = this.voiced(an);
      if (v.length < 12) return { ok: null, reason: 'short' };

      var z = this.ZONE[mode || 'tail'];
      var n = v.length;
      var core = v.slice(Math.floor(n * z.core[0]), Math.floor(n * z.core[1]))
                  .map(function (x) { return x.ratio; });
      var tail = v.slice(Math.floor(n * z.target[0]), Math.ceil(n * z.target[1]))
                  .map(function (x) { return x.ratio; });
      if (core.length < 4 || tail.length < 4) return { ok: null, reason: 'short' };

      var cMed = median(core);
      var tMax = Math.max.apply(null, tail);             // r 은 순간적으로 나타난다
      var rise = tMax / (cMed + 1e-12);

      // 임계값은 합성음(F3 2600Hz 유지 vs 1500Hz 하강)으로 맞춰 잡았다
      var RHOTIC_AT = 1.55;
      var isRhotic = rise >= RHOTIC_AT;
      var margin = Math.abs(rise - RHOTIC_AT) / RHOTIC_AT;
      var conf = margin >= 0.35 ? '높음' : margin >= 0.15 ? '보통' : '낮음';

      return {
        ok: expectRhotic ? isRhotic : !isRhotic,
        isRhotic: isRhotic,
        rise: Math.round(rise * 100) / 100,
        conf: conf,
        reason: null
      };
    },

    // 곡선 그리기 — 시간에 따른 '낮은 띠/높은 띠' 비
    draw: function (canvas, an, mode) {
      var g = canvas.getContext('2d');
      var dpr = canvas._dpr || 1;
      var W = canvas.width / dpr, H = canvas.height / dpr;
      var css = getComputedStyle(document.body);
      var line = css.getPropertyValue('--line') || '#E2DCD0';
      var ink = css.getPropertyValue('--ink') || '#1E3A5F';
      var brick = css.getPropertyValue('--brick') || '#B4623A';
      var dim = css.getPropertyValue('--dim') || '#6B7280';
      g.clearRect(0, 0, W, H);

      var v = this.voiced(an);
      var pad = 16, top = 12, bot = H - 16;
      g.strokeStyle = line; g.lineWidth = 1;
      g.beginPath(); g.moveTo(pad, bot); g.lineTo(W - pad, bot); g.stroke();

      if (v.length < 6) {
        g.fillStyle = dim; g.font = '12px sans-serif'; g.textAlign = 'center';
        g.fillText('소리가 충분히 잡히지 않았습니다', W / 2, H / 2);
        return;
      }
      var vals = v.map(function (x) { return x.ratio; });
      var mx = Math.max.apply(null, vals), mn = Math.min.apply(null, vals);
      var span = Math.max(0.001, mx - mn);
      var y = function (r) { return bot - ((r - mn) / span) * (bot - top); };

      // r 이 나올 자리 표시
      var z = this.ZONE[(arguments[2]) || 'tail'];
      var tailX = pad + z.target[0] * (W - pad * 2);
      g.strokeStyle = brick; g.setLineDash([3, 3]);
      g.beginPath(); g.moveTo(tailX, top); g.lineTo(tailX, bot); g.stroke();
      g.setLineDash([]);
      g.fillStyle = brick; g.font = '10px sans-serif'; g.textAlign = 'left';
      g.fillText('여기부터가 r 자리', tailX + 4, top + 10);

      g.strokeStyle = ink; g.lineWidth = 2.2; g.lineJoin = 'round';
      g.beginPath();
      vals.forEach(function (r, i) {
        var xx = pad + (i / (vals.length - 1)) * (W - pad * 2);
        if (i) g.lineTo(xx, y(r)); else g.moveTo(xx, y(r));
      });
      g.stroke();
    }
  };

  function median(a) {
    var b = a.slice().sort(function (p, q) { return p - q; });
    return b[Math.floor(b.length / 2)];
  }

  w.Rhotic = Rhotic;
})(window);
