import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface StoredObject {
  key: string;
  sha256: string;
  sizeBytes: number;
}

/** Evidence object storage. Keys are content-addressed, so objects are never overwritten. */
export interface EvidenceStorage {
  put(bytes: Uint8Array, mimeType: string, challengeId: string): Promise<StoredObject>;
  get(key: string): Promise<{ bytes: Uint8Array; mimeType: string } | null>;
}

export const ALLOWED_MIME: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/heic": "heic",
  "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm",
  "application/pdf": "pdf", "text/plain": "txt",
};
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_FILES = 5;

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function keyFor(challengeId: string, hash: string, mimeType: string): string {
  if (!/^[a-z0-9]+$/i.test(challengeId)) throw new Error("invalid challenge id");
  return `${challengeId}/${hash}.${ALLOWED_MIME[mimeType] ?? "bin"}`;
}

export class LocalEvidenceStorage implements EvidenceStorage {
  constructor(private readonly dir: string) {}
  private resolve(key: string): string {
    const p = path.resolve(this.dir, key);
    if (!p.startsWith(path.resolve(this.dir) + path.sep)) throw new Error("path traversal");
    return p;
  }
  async put(bytes: Uint8Array, mimeType: string, challengeId: string): Promise<StoredObject> {
    const sha256 = sha256Hex(bytes);
    const key = keyFor(challengeId, sha256, mimeType);
    const file = this.resolve(key);
    await mkdir(path.dirname(file), { recursive: true });
    const exists = await stat(file).then(() => true, () => false);
    if (!exists) await writeFile(file, bytes, { flag: "wx" });
    return { key, sha256, sizeBytes: bytes.byteLength };
  }
  async get(key: string) {
    const ext = key.split(".").pop() ?? "";
    const mimeType = Object.entries(ALLOWED_MIME).find(([, e]) => e === ext)?.[0] ?? "application/octet-stream";
    try {
      return { bytes: new Uint8Array(await readFile(this.resolve(key))), mimeType };
    } catch {
      return null;
    }
  }
}

export class SupabaseEvidenceStorage implements EvidenceStorage {
  private client: SupabaseClient;
  constructor(url: string, serviceKey: string, private readonly bucket: string) {
    this.client = createClient(url, serviceKey, { auth: { persistSession: false } });
  }
  async put(bytes: Uint8Array, mimeType: string, challengeId: string): Promise<StoredObject> {
    const sha256 = sha256Hex(bytes);
    const key = keyFor(challengeId, sha256, mimeType);
    const { error } = await this.client.storage.from(this.bucket).upload(key, bytes, { contentType: mimeType, upsert: false });
    // Same content already stored → same key; that's fine (content-addressed).
    if (error && !/exists|Duplicate/i.test(error.message)) throw new Error(`storage upload failed: ${error.message}`);
    return { key, sha256, sizeBytes: bytes.byteLength };
  }
  async get(key: string) {
    const { data, error } = await this.client.storage.from(this.bucket).download(key);
    if (error || !data) return null;
    return { bytes: new Uint8Array(await data.arrayBuffer()), mimeType: data.type || "application/octet-stream" };
  }
}

export function storageFromEnv(env: Record<string, string | undefined> = process.env): EvidenceStorage {
  if ((env.STORAGE_DRIVER ?? "local") === "supabase") {
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
    return new SupabaseEvidenceStorage(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, env.SUPABASE_BUCKET ?? "evidence");
  }
  return new LocalEvidenceStorage(path.resolve(env.LOCAL_UPLOAD_DIR ?? "./uploads"));
}
