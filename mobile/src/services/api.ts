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

const REQUEST_TIMEOUT_MS = 15_000;

export class Api {
  private token: string | null = null;
  private tokenPromise: Promise<string> | null = null;

  constructor(
    readonly baseUrl: string,
    private readonly credentials: Credentials | null = null,
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
    const text = await res.text();
    const body = text ? (JSON.parse(text) as unknown) : null;
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

  createGroup(input: { id: string; encryptedMeta: string; groupCode: string; keywords: string[]; sealedKey: string; ephemeralSeconds?: number | null }) {
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

  sendMessage(groupId: string, msg: { clientId: string; keyVersion: number; nonce: string; ciphertext: string; signature: string }) {
    return this.request<WireMessage>(`/groups/${groupId}/messages`, { method: 'POST', json: msg });
  }

  messages(groupId: string, after: number, limit = 100) {
    return this.request<{ messages: WireMessage[]; hasMore: boolean }>(
      `/groups/${groupId}/messages?after=${after}&limit=${limit}`,
    );
  }
}
