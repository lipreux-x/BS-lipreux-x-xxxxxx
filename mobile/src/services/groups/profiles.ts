import { keyFingerprint, parsePublicIdentity } from '@/crypto';
import { NetworkError, type Api, type Profile } from '../api';
import { records, type LocalStore } from '../localStore';
import type { Vault } from '../vault';

export interface KnownProfile extends Profile {
  /** The server now returns other keys than the ones pinned on this phone: they are not used. */
  keyChanged: boolean;
}

/**
 * Public profiles of group members, cached for the session. Each contact's
 * keys are pinned in the vault the first time this phone sees them; after
 * that the pinned keys are the only ones used (the server's copy is only
 * compared, and a difference is flagged).
 */
export class ProfileCache {
  private readonly byId = new Map<string, KnownProfile>();
  constructor(
    private readonly api: Api,
    private readonly vault: Vault,
    private readonly masterKey: Uint8Array,
    /** Where profiles are saved for offline use (names, avatars; keys still come from the pins). */
    private readonly local: LocalStore | null = null,
  ) {}

  async get(ids: string[]): Promise<Map<string, KnownProfile>> {
    const missing = [...new Set(ids)].filter((id) => !this.byId.has(id));
    if (missing.length) {
      for (const p of await this.fetch(missing)) {
        const pinned = await this.vault.pinned(p.id, this.masterKey);
        if (!pinned) {
          await this.vault.pin(p.id, { signPublicKey: p.publicKeySign, boxPublicKey: p.publicKeyBox }, this.masterKey);
          this.byId.set(p.id, { ...p, keyChanged: false });
        } else {
          const changed = pinned.signPublicKey !== p.publicKeySign || pinned.boxPublicKey !== p.publicKeyBox;
          this.byId.set(p.id, { ...p, publicKeySign: pinned.signPublicKey, publicKeyBox: pinned.boxPublicKey, keyChanged: changed });
        }
      }
    }
    return this.byId;
  }

  /** From the server (saved on the phone); offline, the profiles saved earlier. */
  private async fetch(ids: string[]): Promise<Profile[]> {
    try {
      const fetched = await this.api.profiles(ids);
      if (this.local && fetched.length) {
        const saved = (await this.local.getRecord<Record<string, Profile>>(records.profiles).catch(() => null)) ?? {};
        for (const p of fetched) saved[p.id] = p;
        await this.local.setRecord(records.profiles, saved).catch(() => {});
      }
      return fetched;
    } catch (e) {
      if (!(e instanceof NetworkError) || !this.local) throw e;
      const saved = (await this.local.getRecord<Record<string, Profile>>(records.profiles)) ?? {};
      return ids.flatMap((id) => (saved[id] ? [saved[id]] : []));
    }
  }

  /** Pinned keys of these users; a user whose keys changed is left out (never trusted). */
  async trustedKeys(ids: string[]): Promise<Map<string, { signPublicKey: Uint8Array; boxPublicKey: Uint8Array }>> {
    const known = await this.get(ids);
    const out = new Map<string, { signPublicKey: Uint8Array; boxPublicKey: Uint8Array }>();
    for (const id of ids) {
      const p = known.get(id);
      if (p && !p.keyChanged) out.set(id, parsePublicIdentity(p));
    }
    return out;
  }

  /** After changing our own avatar: shown right away in groups and chats. */
  setAvatar(id: string, avatar: string | null) {
    const p = this.byId.get(id);
    if (p) this.byId.set(id, { ...p, avatar });
  }
}

/** A contact's key fingerprint, from the keys pinned on this phone (compare with the one on their phone). */
export async function fingerprintOf(profiles: ProfileCache, userId: string): Promise<{ fingerprint: string; keyChanged: boolean } | null> {
  const p = (await profiles.get([userId])).get(userId);
  if (!p) return null;
  return { fingerprint: keyFingerprint(parsePublicIdentity(p)), keyChanged: p.keyChanged };
}
