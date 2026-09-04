export interface BrowserDownloadManager {
  download(filename: string, blob: Blob): void;
  stop(): void;
}

const DEFAULT_OBJECT_URL_LIFETIME_MS = 30_000;

/** Owns every object URL and timer created by a content capability. */
export function createBrowserDownloadManager(
  objectUrlLifetimeMs = DEFAULT_OBJECT_URL_LIFETIME_MS,
): BrowserDownloadManager {
  const pending = new Map<string, ReturnType<typeof setTimeout>>();

  const revoke = (url: string) => {
    const timer = pending.get(url);
    if (timer !== undefined) clearTimeout(timer);
    pending.delete(url);
    URL.revokeObjectURL(url);
  };

  return {
    download(filename, blob) {
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      pending.set(url, setTimeout(() => revoke(url), objectUrlLifetimeMs));
    },
    stop() {
      for (const url of [...pending.keys()]) revoke(url);
    },
  };
}
