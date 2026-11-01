const CACHE="que-roles-admin-shell-v3";
self.addEventListener("install",event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.add("/admin/"))));
self.addEventListener("activate",event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key))))));
self.addEventListener("fetch",event=>{const url=new URL(event.request.url);if(event.request.method!=="GET"||url.origin!==location.origin||url.pathname!=="/admin/")return;event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request)));});
