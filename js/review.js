/* 복습 고르기 — 간격반복(D-1/D-3/D-7/D-14) + 점수 낮았던 약점 문장
 * 앞의 4문장은 텔레그램 발송(chinese_daily.py)과 같은 규칙으로 뽑아
 * 아침 메시지와 웹 화면이 어긋나지 않게 한다.
 */
(function (w) {
  'use strict';
  var OFFSETS = [1, 3, 7, 14];

  var Review = {
    spaced: function (data, day) {
      var byDay = {};
      data.days.forEach(function (x) { byDay[x.d] = x; });
      var out = [];
      OFFSETS.forEach(function (off) {
        var src = byDay[day - off];
        if (!src || !src.items || !src.items.length) return;
        var idx = (day + off) % src.items.length;
        out.push({ off: off, srcDay: src.d, idx: idx, item: src.items[idx] });
      });
      return out;
    },

    // 지금까지 말해본 문장 중 점수가 낮았던 것들 (기본 70점 미만, 최대 2개)
    weak: function (data, lang, day, limit, threshold) {
      limit = limit || 2;
      threshold = (threshold == null) ? 70 : threshold;
      var byDay = {};
      data.days.forEach(function (x) { byDay[x.d] = x; });
      var pool = [];
      var scores = w.Store.state[lang].scores;
      for (var k in scores) {
        var p = k.split('-'), d = parseInt(p[0], 10), i = parseInt(p[1], 10);
        if (!(d < day)) continue;                 // 오늘 것은 제외
        if (scores[k] >= threshold) continue;
        var src = byDay[d];
        if (!src || !src.items || !src.items[i]) continue;
        pool.push({ srcDay: d, idx: i, item: src.items[i], score: scores[k] });
      }
      pool.sort(function (a, b) { return a.score - b.score || b.srcDay - a.srcDay; });
      return pool.slice(0, limit);
    }
  };

  w.Review = Review;
})(window);
