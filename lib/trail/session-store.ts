import type { DroppedImage } from "./image";
import {
  imagesToWrite,
  restoreSession,
  toStoredSession,
  type Session,
} from "./session";

const DATABASE = "trailhead";
const SESSIONS = "sessions";
const IMAGES = "images";
const CURRENT = "current";

let database: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(SESSIONS);
      request.result.createObjectStore(IMAGES, { keyPath: "id" });
    };
    request.onsuccess = () => {
      // The browser can close it, for example when site data is cleared.
      request.result.onclose = () => {
        database = null;
      };
      resolve(request.result);
    };
    request.onerror = () => {
      database = null;
      reject(request.error);
    };
  });
  return database;
}

function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function finished(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
  });
}

let askedToKeep = false;

/** Otherwise the browser may evict the trail when the disk runs low. */
function askToKeep() {
  if (askedToKeep) return;
  askedToKeep = true;
  void navigator.storage?.persist?.().catch(() => {});
}

/** Images known to be stored. Marked only once their transaction has committed. */
const committed = new WeakSet<DroppedImage>();

/** Rejects when this browser has no usable storage. */
export async function loadSession(): Promise<Session | null> {
  const db = await openDatabase();
  const transaction = db.transaction([SESSIONS, IMAGES], "readonly");
  const [record, images] = await Promise.all([
    result(transaction.objectStore(SESSIONS).get(CURRENT)),
    result(transaction.objectStore(IMAGES).getAll()),
  ]);
  const session = restoreSession(record, images, Date.now());
  for (const image of Object.values(session?.images ?? {})) {
    committed.add(image);
  }
  return session;
}

/** When the stored session was saved, without reading every image. */
export async function loadSavedAt(): Promise<number | null> {
  const db = await openDatabase();
  const record: { savedAt?: number } | undefined = await result(
    db.transaction(SESSIONS).objectStore(SESSIONS).get(CURRENT),
  );
  return record?.savedAt ?? null;
}

/**
 * The record and its images land together or not at all, so a stored session
 * never points at an image that failed to save.
 */
export async function saveSession(session: Session): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction([SESSIONS, IMAGES], "readwrite");
  const images = transaction.objectStore(IMAGES);
  const storedIds = images.getAllKeys();
  storedIds.onsuccess = () => {
    const changed = imagesToWrite(
      session.images,
      new Set(storedIds.result),
      committed,
    );
    for (const image of changed) images.put(image);
    transaction.objectStore(SESSIONS).put(toStoredSession(session), CURRENT);
  };
  await finished(transaction);
  for (const image of Object.values(session.images)) committed.add(image);
  if (session.messages.length > 0) askToKeep();
}

export async function clearSession(): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction([SESSIONS, IMAGES], "readwrite");
  transaction.objectStore(SESSIONS).clear();
  transaction.objectStore(IMAGES).clear();
  await finished(transaction);
}
