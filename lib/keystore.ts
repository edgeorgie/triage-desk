export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface StoredKeys<T> {
  value: T | null;
  remember: boolean;
}

function read<T>(store: StorageLike, name: string): T | null {
  try {
    const raw = store.getItem(name);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === "object" ? (parsed as T) : null;
  } catch {
    return null;
  }
}

/** Provider keys live in sessionStorage unless the user chose to remember them on this device. */
export function readKeys<T>(name: string, session: StorageLike, local: StorageLike): StoredKeys<T> {
  const fromSession = read<T>(session, name);
  if (fromSession) return { value: fromSession, remember: false };
  const fromLocal = read<T>(local, name);
  return { value: fromLocal, remember: fromLocal !== null };
}

export function writeKeys<T>(name: string, value: T, remember: boolean, session: StorageLike, local: StorageLike): void {
  const [keep, drop] = remember ? [local, session] : [session, local];
  try {
    keep.setItem(name, JSON.stringify(value));
  } catch {}
  try {
    drop.removeItem(name);
  } catch {}
}

export function clearKeys(name: string, session: StorageLike, local: StorageLike): void {
  for (const store of [session, local]) {
    try {
      store.removeItem(name);
    } catch {}
  }
}
