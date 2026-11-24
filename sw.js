// Replace the original worker at its existing URL and scope.
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>{
 event.waitUntil((async()=>{
  const names=await caches.keys();
  await Promise.all(names.filter(name=>name.startsWith('note-trainer-')&&
   (!name.includes('@')||name.endsWith('@'+self.registration.scope))).map(name=>caches.delete(name)));
  await self.clients.claim();
 })());
});
