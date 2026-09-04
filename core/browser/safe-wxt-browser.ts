const proxyCache = new WeakMap<object, unknown>();

function getNativeBrowser(): unknown {
  const globalValue = globalThis as typeof globalThis & {
    browser?: unknown;
    chrome?: unknown;
  };

  return safeRead(() => globalValue.browser) || safeRead(() => globalValue.chrome);
}

function safeRead<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch (error) {
    if (isExtensionContextInvalidated(error)) return undefined;
    throw error;
  }
}

function isExtensionContextInvalidated(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('Extension context invalidated') ||
    message.includes('context invalidated');
}

function createSafeProxy<T extends object>(target: T): T {
  const existing = proxyCache.get(target);
  if (existing) return existing as T;

  const proxy = new Proxy(target, {
    get(currentTarget, property, receiver) {
      let value: unknown;
      try {
        value = Reflect.get(currentTarget, property, receiver);
      } catch (error) {
        if (isExtensionContextInvalidated(error)) return undefined;
        throw error;
      }

      if (typeof value === 'function') {
        return (...args: unknown[]) => {
          try {
            return value.apply(currentTarget, args);
          } catch (error) {
            if (isExtensionContextInvalidated(error)) return undefined;
            throw error;
          }
        };
      }

      if (value && typeof value === 'object') {
        return createSafeProxy(value);
      }

      return value;
    },
  });

  proxyCache.set(target, proxy);
  return proxy;
}

const nativeBrowser = getNativeBrowser();

export const browser = nativeBrowser && typeof nativeBrowser === 'object'
  ? createSafeProxy(nativeBrowser)
  : nativeBrowser;
