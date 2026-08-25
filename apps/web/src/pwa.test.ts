import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import {
  registerPwa,
  resolvePwaUrl,
  schedulePwaRegistration
} from "./pwa.js";

describe("PWA registration", () => {
  it("resolves files and scope relative to a GitHub Pages subpath", () => {
    const baseUrl = "https://example.github.io/music-trainer/";

    expect(resolvePwaUrl("./sw.js", baseUrl)).toBe(
      "https://example.github.io/music-trainer/sw.js"
    );
    expect(resolvePwaUrl("./", baseUrl)).toBe(
      "https://example.github.io/music-trainer/"
    );
  });

  it("registers a same-subpath worker without HTTP cache reuse", async () => {
    const registration = {} as ServiceWorkerRegistration;
    const register = vi.fn().mockResolvedValue(registration);

    await expect(
      registerPwa({
        baseUrl: "https://example.github.io/music-trainer/",
        buildId: "test-build",
        serviceWorker: { register }
      })
    ).resolves.toBe(registration);

    expect(register).toHaveBeenCalledWith(
      "https://example.github.io/music-trainer/sw.js?build=test-build",
      {
        scope: "https://example.github.io/music-trainer/",
        updateViaCache: "none"
      }
    );
  });

  it("fails gracefully when service worker registration is rejected", async () => {
    const error = new Error("registration unavailable");
    const warn = vi.fn();

    await expect(
      registerPwa({
        baseUrl: "https://example.github.io/music-trainer/",
        buildId: "test-build",
        serviceWorker: { register: vi.fn().mockRejectedValue(error) },
        warn
      })
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.any(String), error);
  });

  it("waits for page load before registering", async () => {
    let loadListener: (() => void) | undefined;
    const register = vi.fn().mockResolvedValue({});

    schedulePwaRegistration({
      baseUrl: "https://example.github.io/music-trainer/",
      serviceWorker: { register },
      addLoadListener: (listener) => {
        loadListener = listener;
      }
    });

    expect(register).not.toHaveBeenCalled();
    loadListener?.();
    await vi.waitFor(() => expect(register).toHaveBeenCalledOnce());
  });
});

type WorkerEventName = "activate" | "fetch" | "install";
type WorkerHandler = (event: Record<string, unknown>) => void;

const origin = "https://example.github.io";
const scopeUrl = `${origin}/music-trainer/`;
const shellUrl = scopeUrl;
const assetManifestUrl = `${scopeUrl}asset-manifest.json`;
const assetManifest = {
  "index.html": {
    file: "assets/index-entry.js",
    css: ["assets/index.css"],
    assets: ["assets/app-mark.svg"],
    isEntry: true
  },
  "node_modules/opensheetmusicdisplay/build/opensheetmusicdisplay.min.js": {
    file: "assets/opensheetmusicdisplay.min-osmd.js",
    isDynamicEntry: true
  }
};

function requestUrl(request: RequestInfo | URL): string {
  if (typeof request === "string") return request;
  if (request instanceof URL) return request.href;
  return request.url;
}

class MemoryCache {
  readonly entries = new Map<string, Response>();

  constructor(
    private readonly fetchResource: (request: RequestInfo | URL) => Promise<Response>
  ) {}

  async addAll(requests: readonly (RequestInfo | URL)[]): Promise<void> {
    await Promise.all(
      requests.map(async (request) => {
        const response = await this.fetchResource(request);
        if (!response.ok) throw new TypeError(`Failed to cache ${requestUrl(request)}`);
        await this.put(request, response);
      })
    );
  }

  async put(request: RequestInfo | URL, response: Response): Promise<void> {
    this.entries.set(requestUrl(request), response.clone());
  }

  async match(request: RequestInfo | URL): Promise<Response | undefined> {
    return this.entries.get(requestUrl(request))?.clone();
  }
}

class MemoryCacheStorage {
  readonly deleted: string[] = [];
  readonly openCalls: string[] = [];
  private readonly stores = new Map<string, MemoryCache>();

  constructor(
    private readonly fetchResource: (request: RequestInfo | URL) => Promise<Response>
  ) {}

  async open(name: string): Promise<MemoryCache> {
    this.openCalls.push(name);
    let cache = this.stores.get(name);
    if (!cache) {
      cache = new MemoryCache(this.fetchResource);
      this.stores.set(name, cache);
    }
    return cache;
  }

  async keys(): Promise<string[]> {
    return [...this.stores.keys()];
  }

  async delete(name: string): Promise<boolean> {
    this.deleted.push(name);
    return this.stores.delete(name);
  }

  async match(request: RequestInfo | URL): Promise<Response | undefined> {
    for (const cache of this.stores.values()) {
      const response = await cache.match(request);
      if (response) return response;
    }
    return undefined;
  }

  get(name: string): MemoryCache | undefined {
    return this.stores.get(name);
  }
}

interface MockRequestOptions {
  destination: RequestDestination;
  method?: string;
  mode?: RequestMode;
}

function mockRequest(url: string, options: MockRequestOptions): Request {
  return {
    destination: options.destination,
    method: options.method ?? "GET",
    mode: options.mode ?? "cors",
    url
  } as Request;
}

interface WorkerHarnessOptions {
  buildId?: string;
  failures?: readonly string[];
}

function createWorkerHarness(options: WorkerHarnessOptions = {}) {
  const buildId = options.buildId ?? "build-123";
  const failures = new Set(options.failures ?? []);
  const handlers = new Map<WorkerEventName, WorkerHandler>();
  const network = new Map<string, Response | Error>([
    [shellUrl, new Response("<html>offline shell</html>", { headers: { "content-type": "text/html" } })],
    [assetManifestUrl, Response.json(assetManifest)],
    [`${scopeUrl}assets/index-entry.js`, new Response("entry-js", { headers: { "x-asset": "entry" } })],
    [`${scopeUrl}assets/index.css`, new Response("entry-css")],
    [`${scopeUrl}assets/app-mark.svg`, new Response("app-mark")],
    [`${scopeUrl}assets/opensheetmusicdisplay.min-osmd.js`, new Response("osmd-js")],
    [`${scopeUrl}manifest.webmanifest`, new Response("web-manifest")],
    [`${scopeUrl}icon-192.png`, new Response("icon-192")],
    [`${scopeUrl}icon-512.png`, new Response("icon-512")]
  ]);
  const fetchResource = vi.fn(async (request: RequestInfo | URL) => {
    const url = requestUrl(request);
    if (failures.has(url)) throw new Error(`Network failed for ${url}`);
    const result = network.get(url);
    if (result instanceof Error) throw result;
    if (!result) return new Response("missing", { status: 404 });
    return result.clone();
  });
  const caches = new MemoryCacheStorage(fetchResource);
  const skipWaiting = vi.fn().mockResolvedValue(undefined);
  const claim = vi.fn().mockResolvedValue(undefined);
  const workerSource = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");

  runInNewContext(workerSource, {
    Error,
    Object,
    Promise,
    Request,
    Response,
    Set,
    TypeError,
    URL,
    caches,
    fetch: fetchResource,
    self: {
      addEventListener: (name: WorkerEventName, handler: WorkerHandler) => {
        handlers.set(name, handler);
      },
      clients: { claim },
      location: new URL(`${scopeUrl}sw.js?build=${encodeURIComponent(buildId)}`),
      registration: { scope: scopeUrl },
      skipWaiting
    }
  }, { filename: "apps/web/public/sw.js" });

  function dispatchLifetimeEvent(name: "activate" | "install"): Promise<unknown> {
    let lifetime: Promise<unknown> | undefined;
    const handler = handlers.get(name);
    if (!handler) throw new Error(`Missing ${name} handler`);
    handler({
      waitUntil(value: Promise<unknown>) {
        lifetime = Promise.resolve(value);
      }
    });
    if (!lifetime) throw new Error(`${name} did not call waitUntil`);
    return lifetime;
  }

  function dispatchFetch(request: Request) {
    let response: Promise<Response> | undefined;
    const lifetimes: Promise<unknown>[] = [];
    const handler = handlers.get("fetch");
    if (!handler) throw new Error("Missing fetch handler");
    handler({
      request,
      respondWith(value: Promise<Response>) {
        response = Promise.resolve(value);
      },
      waitUntil(value: Promise<unknown>) {
        lifetimes.push(Promise.resolve(value));
      }
    });
    return { lifetimes, response };
  }

  return {
    buildId,
    caches,
    claim,
    dispatchFetch,
    dispatchLifetimeEvent,
    fetchResource,
    network,
    skipWaiting
  };
}

describe("service worker execution", () => {
  it("pre-caches the full generated app shell from the asset manifest", async () => {
    const worker = createWorkerHarness();

    await worker.dispatchLifetimeEvent("install");

    const cacheName = `music-trainer-shell-${worker.buildId}`;
    const cachedUrls = [...(worker.caches.get(cacheName)?.entries.keys() ?? [])].sort();
    expect(cachedUrls).toEqual([
      assetManifestUrl,
      `${scopeUrl}assets/app-mark.svg`,
      `${scopeUrl}assets/index-entry.js`,
      `${scopeUrl}assets/index.css`,
      `${scopeUrl}assets/opensheetmusicdisplay.min-osmd.js`,
      `${scopeUrl}icon-192.png`,
      `${scopeUrl}icon-512.png`,
      `${scopeUrl}manifest.webmanifest`,
      shellUrl
    ].sort());
    expect(await (await worker.caches.match(shellUrl))?.text()).toBe(
      "<html>offline shell</html>"
    );
    expect(worker.skipWaiting).toHaveBeenCalledOnce();
  });

  it("returns the cached shell for offline navigation", async () => {
    const worker = createWorkerHarness();
    await worker.dispatchLifetimeEvent("install");
    worker.network.set(`${scopeUrl}practice/42`, new Error("offline"));

    const event = worker.dispatchFetch(
      mockRequest(`${scopeUrl}practice/42`, {
        destination: "document",
        mode: "navigate"
      })
    );

    expect(event.response).toBeDefined();
    await expect(event.response).resolves.toBeInstanceOf(Response);
    expect(await (await event.response)?.text()).toBe("<html>offline shell</html>");
  });

  it("returns the exact cached asset response when the network is offline", async () => {
    const worker = createWorkerHarness();
    await worker.dispatchLifetimeEvent("install");
    const entryUrl = `${scopeUrl}assets/index-entry.js`;
    worker.network.set(entryUrl, new Error("offline"));

    const event = worker.dispatchFetch(
      mockRequest(entryUrl, { destination: "script" })
    );
    const response = await event.response;

    expect(response?.status).toBe(200);
    expect(response?.headers.get("x-asset")).toBe("entry");
    expect(await response?.text()).toBe("entry-js");
  });

  it("ignores API, cross-origin, and non-GET requests", () => {
    const worker = createWorkerHarness();
    const initialFetchCalls = worker.fetchResource.mock.calls.length;

    const events = [
      worker.dispatchFetch(mockRequest(`${scopeUrl}api/session`, { destination: "" })),
      worker.dispatchFetch(mockRequest("https://api.example.test/data", { destination: "script" })),
      worker.dispatchFetch(
        mockRequest(`${scopeUrl}practice`, { destination: "document", method: "POST" })
      )
    ];

    for (const event of events) expect(event.response).toBeUndefined();
    expect(worker.fetchResource).toHaveBeenCalledTimes(initialFetchCalls);
  });

  it("rejects installation if any required precache asset fails", async () => {
    const worker = createWorkerHarness({ failures: [`${scopeUrl}icon-512.png`] });

    await expect(worker.dispatchLifetimeEvent("install")).rejects.toThrow(
      `Network failed for ${scopeUrl}icon-512.png`
    );
    expect(worker.skipWaiting).not.toHaveBeenCalled();
  });

  it("uses the build query in the cache version and removes older versions", async () => {
    const worker = createWorkerHarness({ buildId: "sha-deadbeef" });
    await worker.caches.open("music-trainer-shell-old-build");
    await worker.caches.open("unrelated-cache");

    await worker.dispatchLifetimeEvent("install");
    await worker.dispatchLifetimeEvent("activate");

    expect(worker.caches.openCalls).toContain("music-trainer-shell-sha-deadbeef");
    expect(worker.caches.deleted).toEqual(["music-trainer-shell-old-build"]);
    expect(await worker.caches.keys()).toContain("unrelated-cache");
    expect(worker.claim).toHaveBeenCalledOnce();
  });
});
