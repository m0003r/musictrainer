const CACHE_VERSION = "music-trainer-shell-v1";
const APP_SHELL_URL = new URL("./", self.registration.scope).href;
const CACHEABLE_DESTINATIONS = new Set([
  "document",
  "font",
  "image",
  "script",
  "style",
  "worker"
]);

function isAppResource(request, url) {
  if (request.method !== "GET" || url.origin !== self.location.origin) {
    return false;
  }

  const scopePath = new URL(self.registration.scope).pathname;
  if (!url.pathname.startsWith(scopePath)) {
    return false;
  }

  const relativePath = url.pathname.slice(scopePath.length);
  if (
    relativePath === "health" ||
    relativePath.startsWith("health/") ||
    relativePath === "api" ||
    relativePath.startsWith("api/")
  ) {
    return false;
  }

  return CACHEABLE_DESTINATIONS.has(request.destination);
}

function isStorable(response) {
  return response.status === 200 && response.type === "basic";
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.add(new Request(APP_SHELL_URL, { cache: "reload" })))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) => key.startsWith("music-trainer-shell-") && key !== CACHE_VERSION
            )
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (!isAppResource(event.request, url)) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (isStorable(response)) {
          event.waitUntil(
            caches
              .open(CACHE_VERSION)
              .then((cache) => cache.put(event.request, response.clone()))
          );
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) {
          return cached;
        }

        if (event.request.mode === "navigate") {
          const shell = await caches.match(APP_SHELL_URL);
          if (shell) {
            return shell;
          }
        }

        return Response.error();
      })
  );
});
