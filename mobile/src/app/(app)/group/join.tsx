import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { GROUP_CODE_LENGTH, NativeCryptoMissingError } from '@/crypto';
import { useUnlocked } from '@/session/SessionProvider';
import { ApiError, NetworkError } from '@/services/api';
import { parseGroupLink, takePendingLink } from '@/services/groupLink';
import { joinGroup, joinWithLink } from '@/services/groups';
import { Button } from '@/ui/Button';
import { CodeEntry } from '@/ui/CodeEntry';
import { INVITE_LENGTH } from '@/ui/invite';
import { InviteCodeInput } from '@/ui/InviteCode';
import { KeywordsForm } from '@/ui/KeywordsForm';
import { Segment } from '@/ui/Segment';
import { colors, space, type } from '@/ui/theme';

/*
 * Key flow: the code + 3 keywords never leave the phone; a key derived from
 * them finds the group (5 tries/hour). That only files a request: an admin
 * approves it from their phone (after comparing our fingerprint in person),
 * which hands us the group key wrapped under the code.
 *
 * Keywords first, code last: the code is checked as it is typed, so the safe
 * display shows blue (joined) or red (wrong code or keywords) right away.
 *
 * A group without a code: the link its admin sent (tapped, it arrives here as
 * `invite`; or pasted, or its 16 characters typed). It files the same request,
 * and is burnt by it: refused, the admin sends a new one.
 */
type Step = { kind: 'keywords'; words?: string[] } | { kind: 'code'; words: string[] } | { kind: 'link' };

export default function JoinGroup() {
  const { session } = useUnlocked();
  const router = useRouter();
  const { invite } = useLocalSearchParams<{ invite?: string }>();
  const [step, setStep] = useState<Step>(invite ? { kind: 'link' } : { kind: 'keywords' });
  // A link tapped (again) while this screen is open: its code, in the link mode.
  const [shown, setShown] = useState(invite);
  if (invite !== shown) {
    setShown(invite);
    if (invite) setStep({ kind: 'link' });
  }
  // Taken here: nothing waits for the app to open any more.
  useEffect(() => {
    if (invite) takePendingLink();
  }, [invite]);

  const modes = (
    <View style={styles.modes}>
      <Segment
        options={[
          { label: 'Code + mots-clés', value: 'keywords' as const },
          { label: 'Lien d’invitation', value: 'link' as const },
        ]}
        value={step.kind === 'link' ? 'link' : 'keywords'}
        onChange={(kind) => setStep(kind === 'link' ? { kind: 'link' } : { kind: 'keywords' })}
      />
    </View>
  );

  if (step.kind === 'link') {
    return (
      <View style={styles.screen}>
        {modes}
        <JoinWithLink
          key={invite ?? ''}
          initial={invite ? (parseGroupLink(invite) ?? '') : ''}
          onJoined={(id) => router.replace({ pathname: '/group/[id]', params: { id } })}
        />
      </View>
    );
  }

  if (step.kind === 'keywords') {
    return (
      <View style={styles.screen}>
        {modes}
        <KeywordsForm
          hint="Les 3 mots-clés du groupe, donnés par un membre avec le code. Majuscules, accents et ordre n’ont pas d’importance."
          submitTitle="Continuer"
          initial={step.words}
          onSubmit={async (words) => {
            setStep({ kind: 'code', words });
            return null;
          }}
        />
      </View>
    );
  }

  const { words } = step;
  return (
    <View style={styles.center}>
      <CodeEntry
        length={GROUP_CODE_LENGTH}
        title="Code du groupe"
        subtitle="Demande-le à un membre, en vrai, avec les 3 mots-clés."
        onComplete={async (code) => {
          try {
            const id = await joinGroup(session, code, words);
            return () => router.replace({ pathname: '/group/[id]', params: { id } });
          } catch (e) {
            if (e instanceof NetworkError) return 'Pas de réseau';
            if (e instanceof ApiError && e.code === 'too_many_attempts') return 'Trop d’essais. Réessaie dans une heure.';
            if (e instanceof ApiError && e.code === 'wrong_code') return 'Code ou mots-clés incorrects';
            if (e instanceof NativeCryptoMissingError) return 'Version de l’app incomplète : installe celle du store';
            return 'Impossible de rejoindre';
          }
        }}
      />
      <Pressable onPress={() => setStep({ kind: 'keywords', words })} hitSlop={8} style={styles.back}>
        <Text style={styles.backLabel}>Modifier les mots-clés</Text>
      </Pressable>
    </View>
  );
}

/** The link (or its 16 characters) from the admin of a group without a code: one tap sends the request. */
function JoinWithLink({ initial, onJoined }: { initial: string; onJoined(groupId: string): void }) {
  const { session } = useUnlocked();
  // The field keeps letters and digits only: a pasted link leaves its last 16, the code (ui/invite.ts).
  const [code, setCode] = useState(initial.replace(/-/g, ''));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      onJoined(await joinWithLink(session, code));
    } catch (e) {
      if (e instanceof NetworkError) setError('Pas de réseau');
      else if (e instanceof ApiError && e.code === 'too_many_attempts') setError('Trop d’essais. Réessaie dans une heure.');
      else if (e instanceof ApiError && e.code === 'invalid_link') setError('Lien invalide, déjà utilisé ou expiré. Demande un nouveau lien à l’admin.');
      else setError('Impossible de rejoindre');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.form}>
      <Text style={type.dim}>
        Pour un groupe sans code. Colle le lien reçu de l’admin, ou tape les 16 caractères de la fin. Il ne sert qu’une fois : si la demande est refusée,
        il en faudra un nouveau.
      </Text>
      <InviteCodeInput
        value={code}
        onChange={(c) => {
          setCode(c);
          setError(null);
        }}
        error={!!error}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button title="Envoyer la demande" onPress={() => void send()} busy={busy} disabled={code.length !== INVITE_LENGTH} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  modes: { paddingHorizontal: space.lg, paddingTop: space.lg },
  form: { padding: space.lg, gap: space.md },
  error: { color: colors.danger },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  back: { marginTop: space.lg },
  backLabel: { color: colors.accentFg, fontSize: 15 },
});
