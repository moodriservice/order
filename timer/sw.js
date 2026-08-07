/*
 * 暮日計時｜Service Worker
 *
 * 為什麼需要這支：localStorage 只保住「資料」，保不住「頁面本身載得進來」。
 * 沒有這層快取，訊號差的時候打開就是一片空白 —— 而「沒訊號也要能立刻開」是硬需求。
 *
 * 改動頁面內容後記得把 CACHE 版本號往上加一，否則使用者會一直開到舊的那份。
 */
'use strict';

var CACHE = 'moodri-timer-v1';

// 這幾個檔缺一個就開不起來，所以在安裝時一次抓齊
var SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
  './icon-maskable.svg',
  '../logo-circle.jpg'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      // 逐個放，避免其中一個 404 就讓整包 addAll 失敗、整個離線功能報銷
      return Promise.all(SHELL.map(function (url) {
        return cache.add(new Request(url, { cache: 'reload' })).catch(function () { return null; });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === CACHE ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;

  // 只管自己家的 GET。寫入端點與 JSONP 查核都是跨網域，
  // 讓它們原封不動走出去 —— 攔下來只會把「同步失敗」變成難查的假象。
  if (req.method !== 'GET') return;
  var url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;

  // 導覽（點主畫面圖示、重新整理）：先給快取，開得起來最重要，
  // 同時在背景抓新版本更新快取，下次開就是新的。
  if (req.mode === 'navigate') {
    event.respondWith(staleWhileRevalidate(req, './index.html'));
    return;
  }
  if (SHELL.some(function (p) { return url.pathname === new URL(p, self.location.href).pathname; })) {
    event.respondWith(staleWhileRevalidate(req, null));
  }
});

function staleWhileRevalidate(req, fallbackKey) {
  return caches.open(CACHE).then(function (cache) {
    return cache.match(req).then(function (hit) {
      var network = fetch(req).then(function (res) {
        if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
        return res;
      }).catch(function () { return null; });

      // 有快取就直接回，背景那條 network 繼續跑完更新快取（不 await，開頁不等網路）
      if (hit) return hit;
      return network.then(function (res) {
        if (res) return res;
        if (fallbackKey) {
          return cache.match(fallbackKey).then(function (f) {
            return f || new Response('離線中，而且這頁還沒被快取起來。連上網路開一次就好了。', {
              status: 503,
              headers: { 'Content-Type': 'text/plain; charset=utf-8' }
            });
          });
        }
        return new Response('', { status: 504 });
      });
    });
  });
}
