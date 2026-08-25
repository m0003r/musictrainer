import { readFileSync } from "node:fs";
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

  it("pre-caches the complete versioned production bundle", () => {
    const worker = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");

    expect(worker).toContain('searchParams.get("build")');
    expect(worker).toContain('new URL("./asset-manifest.json"');
    expect(worker).toContain("Object.values(manifest)");
    expect(worker).toContain("cache.addAll(urls)");
    expect(worker).toContain('"manifest.webmanifest", "icon-192.png", "icon-512.png"');
  });
});
