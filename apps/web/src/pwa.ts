export interface PwaRegistrationEnvironment {
  baseUrl?: string;
  buildId?: string;
  serviceWorker?: Pick<ServiceWorkerContainer, "register">;
  addLoadListener?: (listener: () => void) => void;
  warn?: (message: string, error: unknown) => void;
}

declare const __PWA_BUILD_ID__: string;

function currentBuildId(): string {
  return typeof __PWA_BUILD_ID__ === "undefined" ? "development" : __PWA_BUILD_ID__;
}

export function resolvePwaUrl(path: string, baseUrl: string): string {
  return new URL(path, baseUrl).href;
}

export async function registerPwa(
  environment: PwaRegistrationEnvironment = {}
): Promise<ServiceWorkerRegistration | undefined> {
  const serviceWorker =
    environment.serviceWorker ??
    (typeof navigator !== "undefined" && "serviceWorker" in navigator
      ? navigator.serviceWorker
      : undefined);
  if (!serviceWorker) {
    return undefined;
  }

  const baseUrl = environment.baseUrl ?? document.baseURI;
  const workerUrl = new URL("./sw.js", baseUrl);
  workerUrl.searchParams.set("build", environment.buildId ?? currentBuildId());

  try {
    return await serviceWorker.register(workerUrl.href, {
      scope: resolvePwaUrl("./", baseUrl),
      updateViaCache: "none"
    });
  } catch (error) {
    (environment.warn ?? console.warn)(
      "PWA service worker registration failed; continuing online without offline support.",
      error
    );
    return undefined;
  }
}

export function schedulePwaRegistration(
  environment: PwaRegistrationEnvironment = {}
): void {
  const serviceWorker =
    environment.serviceWorker ??
    (typeof navigator !== "undefined" && "serviceWorker" in navigator
      ? navigator.serviceWorker
      : undefined);

  if (!serviceWorker) {
    return;
  }

  const register = (): void => {
    void registerPwa({ ...environment, serviceWorker });
  };

  if (environment.addLoadListener) {
    environment.addLoadListener(register);
  } else if (document.readyState === "complete") {
    register();
  } else {
    window.addEventListener("load", register, { once: true });
  }
}
