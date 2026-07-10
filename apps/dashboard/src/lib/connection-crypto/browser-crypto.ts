/**
 * Browser-side AES-256-GCM encryption for connection credentials at rest.
 */

const ALGORITHM = 'AES-GCM'
const IV_LENGTH = 12
const VERSION = 1
const KEY_DB_NAME = 'chm-connection-crypto'
const KEY_STORE_NAME = 'keys'
const KEY_ID = 'device-key'

async function openKeyDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(KEY_DB_NAME, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(KEY_STORE_NAME)) {
        db.createObjectStore(KEY_STORE_NAME)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

// Single-flight guard: without it, `getOrCreateDeviceKey` is check-then-act
// (read in a readonly tx, then generate + put in a separate readwrite tx). Two
// concurrent first calls could both miss the key and each generate a distinct
// one — last write wins, and ciphertext under the discarded key becomes
// permanently undecryptable. Memoizing the in-flight promise collapses
// concurrent callers onto one key. Reset to null on failure so a later call can
// retry.
let keyPromise: Promise<CryptoKey> | null = null

async function createDeviceKey(): Promise<CryptoKey> {
  const db = await openKeyDb()

  // Re-read inside the readwrite tx before generating, so a key persisted by a
  // concurrent tab (or an earlier session) wins over a fresh generate.
  const existing = await new Promise<CryptoKey | null>((resolve, reject) => {
    const tx = db.transaction(KEY_STORE_NAME, 'readwrite')
    const store = tx.objectStore(KEY_STORE_NAME)
    const req = store.get(KEY_ID)
    req.onsuccess = () => resolve((req.result as CryptoKey) ?? null)
    req.onerror = () => reject(req.error)
  })

  if (existing) return existing

  const key = await crypto.subtle.generateKey(
    { name: ALGORITHM, length: 256 },
    false,
    ['encrypt', 'decrypt']
  )

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(KEY_STORE_NAME, 'readwrite')
    const req = tx.objectStore(KEY_STORE_NAME).put(key, KEY_ID)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })

  return key
}

export function getOrCreateDeviceKey(): Promise<CryptoKey> {
  if (keyPromise) return keyPromise

  keyPromise = createDeviceKey().catch((error) => {
    keyPromise = null
    throw error
  })

  return keyPromise
}

/** Test-only: clear the memoized device-key promise between cases. */
export function __resetDeviceKeyPromiseForTest(): void {
  keyPromise = null
}

export async function encryptJson<T>(value: T): Promise<string> {
  const key = await getOrCreateDeviceKey()
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
  const plaintext = new TextEncoder().encode(JSON.stringify(value))
  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv },
    key,
    plaintext
  )

  const payload = new Uint8Array(1 + IV_LENGTH + ciphertext.byteLength)
  payload[0] = VERSION
  payload.set(iv, 1)
  payload.set(new Uint8Array(ciphertext), 1 + IV_LENGTH)

  return btoa(String.fromCharCode(...payload))
}

export async function decryptJson<T>(encrypted: string): Promise<T> {
  const key = await getOrCreateDeviceKey()
  const payload = Uint8Array.from(atob(encrypted), (c) => c.charCodeAt(0))

  if (payload[0] !== VERSION) {
    throw new Error('Unsupported encryption version')
  }

  const iv = payload.slice(1, 1 + IV_LENGTH)
  const ciphertext = payload.slice(1 + IV_LENGTH)
  const plaintext = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv },
    key,
    ciphertext
  )

  return JSON.parse(new TextDecoder().decode(plaintext)) as T
}
