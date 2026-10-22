// Nur statische Dateien cachen. Multiplayer, Login und API bleiben immer online.
const CACHE='nebula-frontier-client-v27';
const ASSETS=['/','/index.html','/style.css','/client.js','/command.html','/command.css','/command.js','/install-client.js','/launcher-v27.js','/assets/launcher-nebula.webp','/client-icon.svg'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
 const req=e.request;
 if(req.method!=='GET'||new URL(req.url).origin!==location.origin||req.mode==='navigate')return;
 e.respondWith(fetch(req).then(r=>{if(r.ok){const copy=r.clone();caches.open(CACHE).then(c=>c.put(req,copy));}return r;}).catch(()=>caches.match(req)));
});
