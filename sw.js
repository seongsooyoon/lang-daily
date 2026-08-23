/* 오프라인 캐시 — 지하철·비행기에서도 오늘 공부는 열려야 한다.
 * 배포할 때 deploy.sh 가 VERSION 을 배포 시각으로 바꿔 준다(그래야 새 파일이 내려간다).
 */
var VERSION = '202608240003';
var CACHE = 'langdaily-' + VERSION;
var SHELL = [
  './', './index.html', './manifest.json',
  './css/style.css?v=' + VERSION, './css/theme.css?v=' + VERSION,
  './config.js?v=' + VERSION, './js/auth.js?v=' + VERSION,
  './js/store.js?v=' + VERSION, './js/speech.js?v=' + VERSION,
  './js/review.js?v=' + VERSION, './js/record.js?v=' + VERSION,
  './js/rhotic.js?v=' + VERSION, './js/game.js?v=' + VERSION, './js/report.js?v=' + VERSION, './js/app.js?v=' + VERSION,
  './data/zh.json?v=' + VERSION, './data/en.json?v=' + VERSION,
  './data/motivation.json?v=' + VERSION, './data/boston.json?v=' + VERSION,
  './data/boston_guide.json?v=' + VERSION,
  './icon.svg', './icon-192.png', './icon-512.png', './icon-180.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      // 하나가 실패해도 설치 전체가 무너지지 않게 개별로 담는다
      return Promise.all(SHELL.map(function (u) {
        return c.add(u).catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // 음성인식 등 외부 요청은 건드리지 않는다

  // 페이지(HTML)는 늘 새로 받는다.
  // 캐시를 먼저 내주면 새로 배포해도 어제 화면이 보이는 일이 생긴다(실제로 겪음).
  // 나머지 파일은 주소에 배포 시각이 박혀 있어 캐시를 먼저 써도 안전하다.
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').indexOf('text/html') >= 0) {
    e.respondWith(
      fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        // 인터넷이 없을 때만 캐시로 연다
        return caches.match(req).then(function (hit) { return hit || caches.match('./index.html'); });
      })
    );
    return;
  }

  e.respondWith(
    caches.match(req, { ignoreSearch: false }).then(function (hit) {
      var net = fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () { return hit; });
      return hit || net;
    })
  );
});
