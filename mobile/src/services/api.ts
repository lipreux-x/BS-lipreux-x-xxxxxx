import {
  loginSignature,
  registrationProof,
  toPublicIdentity,
  type BackupParams,
  type Identity,
  type KeyBackup,
  type PublicIdentity,
} from '@/crypto';

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
  /** Account color id (ui/accountColors.tsx); null or absent: the default. */
  color?: string | null;
}

/** A key handout: the group key for one version, wrapped, sealed to us and signed by an admin. */
export interface WireHandout {
  keyVersion: number;
  sealedKey: string;
  signerId: string;
  signature: string;
  /** The group's name sealed to us beside the key (crypto/group.ts), on handouts that carry one. */
  sealedLabel?: string;
  labelSignature?: string;
  /** Who signed the label when another admin filled it in later; the handout's signer otherwise. */
  labelSignerId?: string;
}

/** A group we asked to join, waiting for an admin: nothing of it is visible yet. */
export interface PendingGroupSummary {
  id: string;
  status: 'pending';
  expiresAt: string | null;
}

export interface GroupSummary {
  id: string;
  status: 'active';
  encryptedMeta: string;
  /** Who wrote the meta (an admin) and their signature over it. */
  metaSignerId: string;
  metaSignature: string;
  currentKeyVersion: number;
  ephemeralSeconds: number | null;
  /** A member left or was removed: the next member who opens the group rotates the key. */
  rotationPending: boolean;
  /** Bumped when the admin changes the code. */
  codeVersion: number;
  /** Self-destruct date (ISO): the group and everything in it is then deleted. */
  expiresAt: string | null;
  role: 'admin' | 'member';
  sealedKeys: WireHandout[];
  /** 'direct': a private conversation between two people (absent from an older server: a group). */
  kind?: 'group' | 'direct';
  /** Private conversation: the other person, as the server says (a hint; the signed meta decides). */
  peerId?: string;
}

export interface Member {
  userId: string;
  role: 'admin' | 'member';
  /** Key versions the server holds a handout of for this member. */
  keyVersions: number[];
  /** Among them, the handouts without the group's name sealed beside the key (absent on an older server). */
  unlabelledKeyVersions?: number[];
}

/** Someone who typed the right code + keywords and waits for an admin (admins only see these). */
export interface JoinRequest {
  userId: string;
  requestedAt: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An id going into a URL path: anything but a UUID is refused before any request. */
function id(value: string): string {
  if (!UUID.test(value)) throw new ApiError(400, 'invalid_id');
  return value;
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
  async register(inviteCode: string, username: string, identity: Identity, backup: KeyBackup) {
    const res = await this.request<{ userId: string; accessToken: string }>('/auth/register', {
      method: 'POST',
      auth: false,
      json: {
        inviteCode,
        username,
        ...toPublicIdentity(identity),
        proof: registrationProof(identity, inviteCode, username),
        backup,
      },
    });
    return res;
  }

  /** Argon2id parameters of a username's key backup (a decoy if there is none). */
  recoverParams(username: string) {
    return this.request<BackupParams>('/auth/recover/params', { method: 'POST', auth: false, json: { username } });
  }

  /** The password-sealed identity, once authKey matches. 401 bad_credentials, 429 too_many_attempts. */
  recover(username: string, authKey: string) {
    return this.request<{ userId: string; box: string }>('/auth/recover', { method: 'POST', auth: false, json: { username, authKey } });
  }

  me() {
    return this.request<Profile>('/me');
  }

  /** One of the drawn avatars, or null for the default silhouette. */
  setAvatar(avatar: string | null) {
    return this.request<{ avatar: string | null }>('/me/avatar', { method: 'PUT', json: { avatar } });
  }

  /** One of the account colors, or null for the default. */
  setColor(color: string | null) {
    return this.request<{ color: string | null }>('/me/color', { method: 'PUT', json: { color } });
  }

  /** This phone's Expo push token and platform (what the server sends it: services/push.ts). */
  setPushToken(token: string, platform: 'ios' | 'android' | null) {
    return this.request<{ ok: true }>('/me/push-token', { method: 'PUT', json: { token, platform: platform ?? undefined } });
  }

  /** The app is open here (renewed every 30 s): no "new message" push meanwhile. `false` withdraws it. */
  presence(awake: boolean) {
    return this.request<{ ok: true }>('/me/presence', { method: awake ? 'PUT' : 'DELETE' });
  }

  createInvite() {
    return this.request<{ code: string; expiresAt: string }>('/invites', { method: 'POST' });
  }

  profiles(ids: string[]) {
    return ids.length ? this.request<Profile[]>(`/profiles?ids=${ids.map(id).join(',')}`) : Promise.resolve([]);
  }

  // ---- groups ------------------------------------------------------------------

  groups() {
    return this.request<(GroupSummary | PendingGroupSummary)[]>('/groups');
  }

  /** Messages waiting in each group past the given seq (group id -> count; groups without any are left out). */
  unread(cursors: Record<string, number>) {
    return this.request<Record<string, number>>('/groups/unread', { method: 'POST', json: { cursors } });
  }

  /** The creator's own handout and the signed meta go up with the group. `joinKey` comes from the code + keywords. */
  createGroup(input: {
    id: string;
    encryptedMeta: string;
    metaSignature: string;
    joinKey: string;
    sealedKey: string;
    keySignature: string;
    sealedLabel?: string;
    labelSignature?: string;
    ephemeralSeconds?: number | null;
    expiresAt?: string | null;
  }) {
    return this.request<{ id: string; currentKeyVersion: number }>('/groups', { method: 'POST', json: input });
  }

  /**
   * Opens a private conversation with someone we share a group with: both
   * handouts and the signed meta go up together. 409 direct_exists: there is
   * already one between us.
   */
  createDirect(input: {
    id: string;
    peerId: string;
    encryptedMeta: string;
    metaSignature: string;
    keys: { userId: string; sealedKey: string; signature: string; sealedLabel?: string; labelSignature?: string }[];
  }) {
    return this.request<{ id: string; currentKeyVersion: number }>('/groups/direct', { method: 'POST', json: input });
  }

  /** Asks to join: pending until an admin approves. The code and keywords never leave the phone, only `joinKey`. */
  joinGroup(joinKey: string) {
    return this.request<{ groupId: string; status: 'pending' | 'active' }>('/groups/join', { method: 'POST', json: { joinKey } });
  }

  /** Active members, and the pending requests (only an admin gets those). */
  members(groupId: string) {
    return this.request<{ currentKeyVersion: number; members: Member[]; pending: JoinRequest[] }>(`/groups/${id(groupId)}/members`);
  }

  /** Admin: the group's name sealed beside handouts that had none (filled in, never replaced). */
  labelKeys(groupId: string, input: { keys: { userId: string; keyVersion: number; sealedLabel: string; labelSignature: string }[] }) {
    return this.request<{ labelled: number }>(`/groups/${id(groupId)}/keys/labels`, { method: 'POST', json: input });
  }

  /** Admin: lets a newcomer in with their handout of the current key and the meta that now lists them. */
  approveMember(
    groupId: string,
    userId: string,
    input: { keyVersion: number; sealedKey: string; keySignature: string; sealedLabel?: string; labelSignature?: string; encryptedMeta: string; metaSignature: string },
  ) {
    return this.request<{ approved: true }>(`/groups/${id(groupId)}/members/${id(userId)}/approve`, { method: 'POST', json: input });
  }

  rejectMember(groupId: string, userId: string) {
    return this.request<{ rejected: true }>(`/groups/${id(groupId)}/members/${id(userId)}/reject`, { method: 'POST' });
  }

  /** Admin: new key, handed to exactly the active members, with the meta (and admin list) written under it. */
  rotateKey(
    groupId: string,
    input: {
      fromKeyVersion: number;
      encryptedMeta: string;
      metaSignature: string;
      admins: string[];
      keys: { userId: string; sealedKey: string; signature: string; sealedLabel?: string; labelSignature?: string }[];
    },
  ) {
    return this.request<{ currentKeyVersion: number }>(`/groups/${id(groupId)}/rotate`, { method: 'POST', json: input });
  }

  /** Admin: who the admins are (the last admin hands the role over before leaving). */
  setAdmins(groupId: string, input: { keyVersion: number; admins: string[]; encryptedMeta: string; metaSignature: string }) {
    return this.request<{ admins: string[] }>(`/groups/${id(groupId)}/admins`, { method: 'PUT', json: input });
  }

  /** 409 handover_required: the last admin must name another one first. A private conversation is deleted, for both. */
  leaveGroup(groupId: string) {
    return this.request<{ left: true }>(`/groups/${id(groupId)}/leave`, { method: 'POST' });
  }

  removeMember(groupId: string, userId: string) {
    return this.request<{ removed: true }>(`/groups/${id(groupId)}/members/${id(userId)}/remove`, { method: 'POST' });
  }

  /** Admin: new join key, new meta, and every handout on the server re-wrapped under the new code. */
  changeGroupCode(
    groupId: string,
    input: {
      joinKey: string;
      keyVersion: number;
      encryptedMeta: string;
      metaSignature: string;
      keys: { userId: string; keyVersion: number; sealedKey: string; signature: string; sealedLabel?: string; labelSignature?: string }[];
    },
  ) {
    return this.request<{ codeVersion: number }>(`/groups/${id(groupId)}/code`, { method: 'PUT', json: input });
  }

  setEphemeral(groupId: string, seconds: number | null) {
    return this.request<{ ephemeralSeconds: number | null }>(`/groups/${id(groupId)}/ephemeral`, { method: 'PUT', json: { seconds } });
  }

  // ---- messages ----------------------------------------------------------------

  /** `attachmentId`: the upload an image message refers to (the server ties its lifetime to the message). */
  sendMessage(
    groupId: string,
    msg: {
      clientId: string;
      keyVersion: number;
      nonce: string;
      ciphertext: string;
      signature: string;
      attachmentId?: string;
      /** A story: gone after this long, whatever the group's disappearing-messages setting. */
      expiresInSeconds?: number;
      /** Nobody is rung for it (a reaction): the server learns only that it is not worth a notification. */
      quiet?: true;
    },
  ) {
    return this.request<WireMessage>(`/groups/${id(groupId)}/messages`, { method: 'POST', json: msg });
  }

  /** `purgeSeq`: latest erase of the group's history (bumped by eraseMessages). */
  messages(groupId: string, after: number, limit = 100) {
    return this.request<{ messages: WireMessage[]; hasMore: boolean; purgeSeq: number }>(
      `/groups/${id(groupId)}/messages?after=${after}&limit=${limit}`,
    );
  }

  /** Admin: erases every message sent in [from, to) for everyone, images included. */
  eraseMessages(groupId: string, from: Date, to: Date) {
    return this.request<{ deleted: number }>(`/groups/${id(groupId)}/messages/erase`, {
      method: 'POST',
      json: { from: from.toISOString(), to: to.toISOString() },
    });
  }

  // ---- attachments (already-encrypted blobs) ---------------------------------------

  /** Reserves an attachment id; the URL accepts exactly `size` bytes for a few minutes. */
  createAttachment(groupId: string, size: number) {
    return this.request<{ id: string; uploadUrl: string }>(`/groups/${id(groupId)}/attachments`, { method: 'POST', json: { size } });
  }

  attachmentUrl(groupId: string, attachmentId: string) {
    return this.request<{ url: string }>(`/groups/${id(groupId)}/attachments/${id(attachmentId)}`);
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
