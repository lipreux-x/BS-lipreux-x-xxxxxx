import { loginSignature, registrationProof, toPublicIdentity, type Identity, type PublicIdentity } from '@/crypto';

/*
 * Typed client for the BaseSecrete API (server/src/app.ts). Only ciphertext,
 * public keys and hashes ever go over the wire. The access token lives in
 * memory only: when it expires the client signs a fresh challenge with the
 * device identity, so nothing reusable is stored on disk.
 */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(code);
    this.name = 'ApiError';
  }
}

export class NetworkError extends Error {
  constructor() {
    super('network');
    this.name = 'NetworkError';
  }
}

export interface Profile extends PublicIdentity {
  id: string;
  username: string;
  /** Drawn avatar id (ui/avatars.tsx); null or absent: the default silhouette. */
  avatar?: string | null;
}

export interface GroupSummary {
  id: string;
  encryptedMeta: string;
  currentKeyVersion: number;
  ephemeralSeconds: number | null;
  /** A member left or was removed: the next member who opens the group rotates the key. */
  rotationPending: boolean;
  /** Bumped when the admin changes the code. */
  codeVersion: number;
  /** Self-destruct date (ISO): the group and everything in it is then deleted. */
  expiresAt: string | null;
  role: 'admin' | 'member';
  sealedKeys: { keyVersion: number; sealedKey: string }[];
}

export interface Member {
  userId: string;
  role: 'admin' | 'member';
  hasCurrentKey: boolean;
}

export interface WireMessage {
  id: string;
  seq: number;
  clientId: string;
  groupId: string;
  senderId: string;
  keyVersion: number;
  nonce: string;
  ciphertext: string;
  signature: string;
  createdAt: string;
  expiresAt: string | null;
}

export interface Credentials {
  userId: string;
  identity: Identity;
}

type Init = { method?: string; json?: unknown; auth?: boolean };

/** fetch able to send and read raw bytes (the app passes expo/fetch; Node's fetch works as is). */
export type BinaryFetch = (
  url: string,
  init: { method: string; headers?: Record<string, string>; body?: Uint8Array; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; bytes(): Promise<Uint8Array> }>;

const REQUEST_TIMEOUT_MS = 15_000;
const TRANSFER_TIMEOUT_MS = 120_000;

export class Api {
  private token: string | null = null;
  private tokenPromise: Promise<string> | null = null;

  constructor(
    readonly baseUrl: string,
    private readonly credentials: Credentials | null = null,
    private readonly binaryFetch: BinaryFetch = fetch as unknown as BinaryFetch,
  ) {}

  // ---- transport -------------------------------------------------------------

  private async raw(path: string, init: Init, token?: string): Promise<Response> {
    // fetch has no timeout of its own: a stalled request would spin forever.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(this.baseUrl + path, {
        signal: controller.signal,
        method: init.method ?? 'GET',
        headers: {
          ...(init.json !== undefined && { 'content-type': 'application/json' }),
          ...(token && { authorization: `Bearer ${token}` }),
        },
        body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
      });
    } catch {
      throw new NetworkError();
    } finally {
      clearTimeout(timer);
    }
  }

  private async request<T>(path: string, init: Init = {}): Promise<T> {
    const needsAuth = init.auth ?? true;
    let res = await this.raw(path, init, needsAuth ? await this.accessToken() : undefined);
    if (res.status === 401 && needsAuth) {
      // Token expired: sign a new challenge once and retry.
      this.token = null;
      res = await this.raw(path, init, await this.accessToken());
    }
    const text = await res.text().catch(() => {
      throw new NetworkError();
    });
    // Our API always answers JSON. Anything else comes from in between (the
    // platform proxy during a cold start or an outage, a captive Wi-Fi portal):
    // a transient network problem, not an answer.
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      throw res.ok || res.status >= 500 ? new NetworkError() : new ApiError(res.status, `http_${res.status}`);
    }
    if (!res.ok) throw new ApiError(res.status, (body as { error?: string } | null)?.error ?? `http_${res.status}`);
    return body as T;
  }

  /** Current access token, logging in with the device key if needed. */
  async accessToken(): Promise<string> {
    if (this.token) return this.token;
    if (!this.credentials) throw new ApiError(401, 'no_credentials');
    this.tokenPromise ??= this.login(this.credentials).finally(() => (this.tokenPromise = null));
    return this.tokenPromise;
  }

  private async login({ userId, identity }: Credentials): Promise<string> {
    const { challenge } = await this.request<{ challenge: string }>('/auth/challenge', {
      method: 'POST',
      json: { userId },
      auth: false,
    });
    const { accessToken } = await this.request<{ accessToken: string }>('/auth/token', {
      method: 'POST',
      json: { challenge, signature: loginSignature(identity, challenge) },
      auth: false,
    });
    this.token = accessToken;
    return accessToken;
  }

  // ---- auth --------------------------------------------------------------------

  /** Consumes an invite. Returns the new user id and a first access token. */
  async register(inviteCode: string, username: string, identity: Identity) {
    const res = await this.request<{ userId: string; accessToken: string }>('/auth/register', {
      method: 'POST',
      auth: false,
      json: {
        inviteCode,
        username,
        ...toPublicIdentity(identity),
        proof: registrationProof(identity, inviteCode, username),
      },
    });
    return res;
  }

  me() {
    return this.request<Profile>('/me');
  }

  /** One of the drawn avatars, or null for the default silhouette. */
  setAvatar(avatar: string | null) {
    return this.request<{ avatar: string | null }>('/me/avatar', { method: 'PUT', json: { avatar } });
  }

  createInvite() {
    return this.request<{ code: string; expiresAt: string }>('/invites', { method: 'POST' });
  }

  profiles(ids: string[]) {
    return ids.length ? this.request<Profile[]>(`/profiles?ids=${ids.join(',')}`) : Promise.resolve([]);
  }

  // ---- groups ------------------------------------------------------------------

  groups() {
    return this.request<GroupSummary[]>('/groups');
  }

  createGroup(input: {
    id: string;
    encryptedMeta: string;
    groupCode: string;
    keywords: string[];
    sealedKey: string;
    ephemeralSeconds?: number | null;
    expiresAt?: string | null;
  }) {
    return this.request<{ id: string; currentKeyVersion: number }>('/groups', { method: 'POST', json: input });
  }

  /** The code identifies the group (codes are unique server-side); the keywords are checked with it. */
  joinGroup(groupCode: string, keywords: string[]) {
    return this.request<{ groupId: string }>('/groups/join', { method: 'POST', json: { groupCode, keywords } });
  }

  members(groupId: string) {
    return this.request<{ currentKeyVersion: number; members: Member[] }>(`/groups/${groupId}/members`);
  }

  shareKeys(groupId: string, keys: { userId: string; keyVersion: number; sealedKey: string }[]) {
    return this.request<{ stored: number }>(`/groups/${groupId}/keys`, { method: 'POST', json: { keys } });
  }

  /** New key sealed to exactly the current members, with the meta re-encrypted under it. */
  rotateKey(groupId: string, input: { fromKeyVersion: number; encryptedMeta: string; keys: { userId: string; sealedKey: string }[] }) {
    return this.request<{ currentKeyVersion: number }>(`/groups/${groupId}/rotate`, { method: 'POST', json: input });
  }

  leaveGroup(groupId: string) {
    return this.request<{ left: true }>(`/groups/${groupId}/leave`, { method: 'POST' });
  }

  removeMember(groupId: string, userId: string) {
    return this.request<{ removed: true }>(`/groups/${groupId}/members/${userId}/remove`, { method: 'POST' });
  }

  changeGroupCode(groupId: string, input: { groupCode: string; keywords: string[]; keyVersion: number; encryptedMeta: string }) {
    return this.request<{ codeVersion: number }>(`/groups/${groupId}/code`, { method: 'PUT', json: input });
  }

  setEphemeral(groupId: string, seconds: number | null) {
    return this.request<{ ephemeralSeconds: number | null }>(`/groups/${groupId}/ephemeral`, { method: 'PUT', json: { seconds } });
  }

  // ---- messages ----------------------------------------------------------------

  /** `attachmentId`: the upload an image message refers to (the server ties its lifetime to the message). */
  sendMessage(
    groupId: string,
    msg: { clientId: string; keyVersion: number; nonce: string; ciphertext: string; signature: string; attachmentId?: string },
  ) {
    return this.request<WireMessage>(`/groups/${groupId}/messages`, { method: 'POST', json: msg });
  }

  /** `purgeSeq`: latest erase of the group's history (bumped by eraseMessages). */
  messages(groupId: string, after: number, limit = 100) {
    return this.request<{ messages: WireMessage[]; hasMore: boolean; purgeSeq: number }>(
      `/groups/${groupId}/messages?after=${after}&limit=${limit}`,
    );
  }

  /** Admin: erases every message sent in [from, to) for everyone, images included. */
  eraseMessages(groupId: string, from: Date, to: Date) {
    return this.request<{ deleted: number }>(`/groups/${groupId}/messages/erase`, {
      method: 'POST',
      json: { from: from.toISOString(), to: to.toISOString() },
    });
  }

  // ---- attachments (already-encrypted blobs) ---------------------------------------

  /** Reserves an attachment id; the URL accepts exactly `size` bytes for a few minutes. */
  createAttachment(groupId: string, size: number) {
    return this.request<{ id: string; uploadUrl: string }>(`/groups/${groupId}/attachments`, { method: 'POST', json: { size } });
  }

  attachmentUrl(groupId: string, attachmentId: string) {
    return this.request<{ url: string }>(`/groups/${groupId}/attachments/${attachmentId}`);
  }

  /** PUT to a presigned storage URL (no API token: the signature is the authorization). */
  async uploadBlob(url: string, blob: Uint8Array): Promise<void> {
    const res = await this.transfer(url, { method: 'PUT', headers: { 'content-type': 'application/octet-stream' }, body: blob });
    if (!res.ok) throw new ApiError(res.status, 'upload_failed');
  }

  async downloadBlob(url: string): Promise<Uint8Array> {
    const res = await this.transfer(url, { method: 'GET' });
    if (!res.ok) throw new ApiError(res.status, 'download_failed');
    try {
      return await res.bytes();
    } catch {
      throw new NetworkError();
    }
  }

  private async transfer(url: string, init: Parameters<BinaryFetch>[1]) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TRANSFER_TIMEOUT_MS);
    try {
      return await this.binaryFetch(url, { ...init, signal: controller.signal });
    } catch {
      throw new NetworkError();
    } finally {
      clearTimeout(timer);
    }
  }
}
