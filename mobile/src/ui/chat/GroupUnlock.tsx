import { Stack } from 'expo-router';
import { Bomb } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { GROUP_CODE_LENGTH } from '@/crypto';
import { useUnlocked, type OpenGroup } from '@/session/SessionProvider';
import { NetworkError } from '@/services/api';
import { GroupTamperedError, KeyChangedError, listedGroups, listGroups, plateName, relockGroup, unlockGroup, type GroupLockState } from '@/services/groups';
import { LockedOutError, WrongCodeError } from '@/services/vault';
import { Button } from '../Button';
import { CodeEntry, type CodeResult } from '../CodeEntry';
import { NamePlate } from '../InviteCode';
import { KeywordsForm } from '../KeywordsForm';
import { Led } from '../Led';
import { Working } from '../Working';
import { colors, fonts, space, type } from '../theme';

/** What to tell the user when the server's data does not check out. */
export function securityMessage(e: unknown): string | null {
  if (e instanceof KeyChangedError) return 'La clé d’un membre a changé : ouverture bloquée par sécurité';
  if (e instanceof GroupTamperedError) {
    return e.reason === 'keywords_mismatch' ? 'Mots-clés incorrects' : 'Données du groupe invalides : ouverture bloquée par sécurité';
  }
  return null;
}

/** While a typed code opens the group's key: what the wait is. */
export const DECRYPTING = 'Déchiffrement des messages…';

export function GroupUnlock({ groupId, onOpen }: { groupId: string; onOpen(g: OpenGroup): void }) {
  const { session, profiles } = useUnlocked();
  // From the list just shown, at once; the fetch below then confirms it.
  const [listed] = useState(() => listedGroups(session)?.find((x) => x.id === groupId));
  const [state, setState] = useState<GroupLockState | null>(listed?.state ?? null);
  // The group's name (or, before it is known, its other members): printed on the keypad's plate.
  const [name, setName] = useState<string | null>(listed ? plateName(listed) : null);
  // Signed in again on this phone: the keywords are needed once, with the code.
  const [keywords, setKeywords] = useState<string[] | null>(null);
  const [firstCode, setFirstCode] = useState<string | null>(null);
  const [mismatch, setMismatch] = useState(false);
  const [lockedFor, setLockedFor] = useState(0);
  // Unlocked with the old code, but the admin changed it: ask for the new one.
  const [relock, setRelock] = useState<{ group: OpenGroup; first: string | null; mismatch: boolean } | null>(null);
  // No longer listed: self-destructed, or we were removed (listGroups erased what the phone kept).
  const [gone, setGone] = useState(false);
  // The admin changed the code, and the keywords too: the new ones are typed before the new code.
  const [newWords, setNewWords] = useState(false);
  // A private conversation: no keywords, its first code is chosen here.
  const [direct, setDirect] = useState(listed?.direct ?? false);
  // A group without a code: the app code (already typed) opens it, nothing is asked here.
  const [link, setLink] = useState(listed?.link ?? false);

  // The header of a locked group: its name beside a red LED when this phone knows
  // it (closed after being opened once, or sealed to us by an admin beside the
  // key), as the open chat shows it beside the blue one.
  const lockedHeader = useMemo(
    () =>
      name
        ? {
            headerTitle: () => (
              <View style={styles.title}>
                <Led state="error" size={7} />
                <Text style={styles.titleText} numberOfLines={1}>
                  {name}
                </Text>
              </View>
            ),
          }
        : { title: direct ? 'Discussion verrouillée' : 'Groupe verrouillé' },
    [name, direct],
  );

  useEffect(() => {
    listGroups(session, profiles)
      .then(({ items }) => {
        const g = items.find((x) => x.id === groupId);
        if (!g) setGone(true);
        setName(g ? plateName(g) : null);
        setDirect(!!g?.direct);
        setLink(!!g?.link);
        setState(g?.state ?? { kind: 'locked', codeChanged: false });
      })
      .catch(() => setState({ kind: 'locked', codeChanged: false }));
  }, [session, profiles, groupId]);

  async function attempt(code: string): Promise<CodeResult> {
    try {
      const res = await unlockGroup(session, profiles, groupId, code, keywords ?? undefined);
      if (!res) {
        setState({ kind: 'waiting-key' });
        return null;
      }
      const group = { keys: res.keys, keyVersion: res.keyVersion, name: res.name, direct: !!res.meta.direct, link: !!res.meta.link };
      if (res.codeChanged) {
        setRelock({ group, first: null, mismatch: false });
        return null;
      }
      return () => onOpen(group);
    } catch (e) {
      if (e instanceof WrongCodeError) return keywords ? 'Code ou mots-clés incorrects' : 'Code incorrect';
      if (e instanceof LockedOutError) {
        setLockedFor(e.retryInMs);
        return 'Trop d’essais';
      }
      if (e instanceof NetworkError) return 'Pas de réseau';
      return securityMessage(e) ?? 'Impossible d’ouvrir le groupe';
    }
  }

  // "Code" beside the group's name on the safe's screen; the plain title when the name is not known yet.
  const codeHeader = name ? <NamePlate label="Code" name={name} /> : undefined;
  const codeTitle = name ? undefined : direct ? 'Code de la discussion' : 'Code du groupe';

  // The admin changed the keywords with the code: the new ones are typed first, then the code.
  if (newWords && !keywords) {
    return (
      <View style={[styles.center, { padding: space.lg }]}>
        <Stack.Screen options={lockedHeader} />
        <KeywordsForm
          hint="Les 3 nouveaux mots-clés donnés par l’admin, puis le nouveau code."
          submitTitle="Continuer"
          onSubmit={async (words) => {
            setKeywords(words);
            setNewWords(false);
            return null;
          }}
        />
        <Pressable accessibilityRole="button" onPress={() => setNewWords(false)} hitSlop={8} style={styles.wordsLink}>
          <Text style={styles.wordsLinkText}>Retour au code</Text>
        </Pressable>
      </View>
    );
  }
  const wordsLink = keywords ? null : (
    <Pressable accessibilityRole="button" onPress={() => setNewWords(true)} hitSlop={8} style={styles.wordsLink}>
      <Text style={styles.wordsLinkText}>Les mots-clés ont changé aussi ?</Text>
    </Pressable>
  );

  if (relock) {
    const { group } = relock;
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: 'Nouveau code' }} />
        {relock.first === null ? (
          <CodeEntry
            length={GROUP_CODE_LENGTH}
            key="new"
            title="Le code du groupe a changé"
            subtitle="Entre le nouveau code, donné en vrai par l’admin."
            initialError={relock.mismatch ? 'Les codes ne correspondent pas' : undefined}
            onComplete={async (code) => {
              setRelock({ group, first: code, mismatch: false });
              return null;
            }}
          />
        ) : (
          <CodeEntry
            length={GROUP_CODE_LENGTH}
            key="confirm-new"
            holdOnSuccess
            busyLabel={DECRYPTING}
            title="Confirme le nouveau code"
            onComplete={async (code) => {
              if (code !== relock.first) {
                setRelock({ group, first: null, mismatch: true });
                return null;
              }
              try {
                // The new code must open the key the admin re-wrapped with it: a wrong one is refused here.
                const r = await relockGroup(session, profiles, groupId, group.keys, code, keywords ?? undefined);
                const opened = { keys: r.keys, keyVersion: r.keyVersion, name: r.name, direct: !!r.meta.direct, link: !!r.meta.link };
                return () => onOpen(opened);
              } catch (e) {
                if (e instanceof WrongCodeError) {
                  setRelock({ group, first: null, mismatch: false });
                  return keywords ? 'Nouveau code ou mots-clés incorrects' : 'Ce n’est pas le nouveau code';
                }
                if (e instanceof LockedOutError) return 'Trop d’essais, réessaie plus tard';
                if (e instanceof NetworkError) return 'Pas de réseau';
                return securityMessage(e) ?? 'Impossible d’enregistrer le code';
              }
            }}
          />
        )}
        {relock.first === null ? wordsLink : null}
      </View>
    );
  }

  if (gone) return <GroupGone direct={direct} />;

  // The group's state is being fetched: the blade turning, not a black screen.
  if (!state) {
    return (
      <View style={styles.center}>
        <Working />
      </View>
    );
  }

  if (state.kind === 'pending') {
    return (
      <View style={[styles.center, { padding: space.lg, gap: space.md }]}>
        <Stack.Screen options={{ title: 'Demande envoyée' }} />
        <Text style={type.heading}>En attente d’un admin</Text>
        <Text style={[type.dim, { textAlign: 'center' }]}>
          Ta demande est arrivée. Un admin du groupe doit l’accepter depuis son téléphone. Pour qu’il soit sûr que c’est bien toi, montre-lui ton
          numéro de sécurité (Réglages) : il le compare avec celui qu’il voit.
        </Text>
      </View>
    );
  }

  if (state.kind === 'waiting-key') {
    return (
      <View style={[styles.center, { padding: space.lg, gap: space.md }]}>
        <Stack.Screen options={lockedHeader} />
        <Text style={type.heading}>En attente de la clé</Text>
        <Text style={[type.dim, { textAlign: 'center' }]}>
          Tu es membre. La nouvelle clé du groupe arrivera chiffrée pour toi dès qu’un admin ouvrira le groupe sur son téléphone.
        </Text>
      </View>
    );
  }

  if (link) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={lockedHeader} />
        <OpenWithoutCode open={() => attempt('')} />
      </View>
    );
  }

  // Signed in again: this phone does not know the keywords yet. They come first, then the code.
  if (state.kind === 'first-unlock' && state.needsKeywords && !keywords) {
    return (
      <View style={[styles.center, { padding: space.lg }]}>
        <Stack.Screen options={lockedHeader} />
        <KeywordsForm
          hint="Tu t’es reconnecté sur ce téléphone : entre les 3 mots-clés du groupe, puis son code."
          submitTitle="Continuer"
          onSubmit={async (words) => {
            setKeywords(words);
            return null;
          }}
        />
      </View>
    );
  }

  // First unlock: the code typed here becomes this phone's lock for the key. Ask twice.
  // A private conversation: there is no shared code, the one chosen here is this phone's own.
  if (state.kind === 'first-unlock') {
    return (
      <View style={styles.center}>
        <Stack.Screen options={lockedHeader} />
        {firstCode === null ? (
          <CodeEntry
            length={GROUP_CODE_LENGTH}
            key="code"
            initialError={mismatch ? 'Les codes ne correspondent pas' : undefined}
            header={codeHeader}
            title={codeTitle}
            subtitle={
              direct
                ? 'Ligne privée, chiffrée pour vous deux. Choisis un code pour la verrouiller sur ce téléphone.'
                : 'La clé est arrivée. Entre le code du groupe pour la protéger sur ce téléphone.'
            }
            onComplete={async (code) => {
              setFirstCode(code);
              return null;
            }}
          />
        ) : (
          <CodeEntry
            length={GROUP_CODE_LENGTH}
            key="confirm"
            holdOnSuccess
            busyLabel={DECRYPTING}
            title="Confirme le code"
            onComplete={async (code) => {
              if (code !== firstCode) {
                setMismatch(true);
                setFirstCode(null);
                return null;
              }
              return attempt(code);
            }}
          />
        )}
        {/* Asked to join before the admin changed the code: the new keywords may be needed. */}
        {firstCode === null && !state.needsKeywords && !direct ? wordsLink : null}
      </View>
    );
  }

  // The admin changed the code since this phone last opened the group: the new one opens it (the old one too).
  const codeChanged = state.kind === 'locked' && state.codeChanged;

  return (
    <View style={styles.center}>
      <Stack.Screen options={lockedHeader} />
      <CodeEntry
        length={GROUP_CODE_LENGTH}
        header={codeHeader}
        title={codeTitle}
        subtitle={codeChanged ? (keywords ? 'Nouveaux mots-clés notés : tape le nouveau code.' : 'L’admin a changé le code : tape le nouveau.') : undefined}
        onComplete={attempt}
        lockedForMs={lockedFor}
        holdOnSuccess
        busyLabel={DECRYPTING}
      />
      {codeChanged ? wordsLink : null}
    </View>
  );
}

/** A group without a code: its key opens at once (master key), the blade turning meanwhile; on a failure, why, and a retry. */
function OpenWithoutCode({ open }: { open(): Promise<CodeResult> }) {
  const [error, setError] = useState<string | null>(null);
  const [tries, setTries] = useState(0);
  // The first one: it only reads the session and the group's id, which do not change here.
  const [run] = useState(() => open);
  useEffect(() => {
    let alive = true;
    void run().then((r) => {
      if (!alive) return;
      if (typeof r === 'string') setError(r);
      else r?.();
    });
    return () => {
      alive = false;
    };
  }, [run, tries]);
  if (!error) return <Working label={DECRYPTING} />;
  return (
    <View style={{ padding: space.lg, gap: space.md, alignItems: 'center' }}>
      <Text style={[type.dim, { textAlign: 'center' }]}>{error}</Text>
      <Button
        title="Réessayer"
        onPress={() => {
          setError(null);
          setTries((n) => n + 1);
        }}
      />
    </View>
  );
}

/** The group no longer exists for us: self-destructed (or we were removed); a private conversation: one of the two deleted it. */
export function GroupGone({ direct }: { direct?: boolean }) {
  return (
    <View style={[styles.center, { padding: space.lg, gap: space.md }]}>
      <Stack.Screen options={{ title: direct ? 'Discussion effacée' : 'Groupe effacé' }} />
      <Bomb size={36} color={colors.danger} />
      <Text style={type.heading}>{direct ? 'Cette discussion n’existe plus' : 'Ce groupe n’existe plus'}</Text>
      <Text style={[type.dim, { textAlign: 'center' }]}>
        {direct ? 'L’un de vous deux l’a supprimée.' : 'Il s’est autodétruit ou tu n’en fais plus partie.'} Ses messages, ses photos, ses vocaux et ses clés ont
        été effacés de ce téléphone.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  title: { flexDirection: 'row', alignItems: 'center', gap: 8, maxWidth: 220 },
  titleText: { color: colors.text, fontSize: 17, fontFamily: fonts.semibold },
  wordsLink: { marginTop: space.md, paddingVertical: space.sm, paddingHorizontal: space.md },
  wordsLinkText: { color: colors.accentFg, fontFamily: fonts.medium, fontSize: 15 },
});
