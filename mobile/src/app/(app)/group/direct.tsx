import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useUnlocked } from '@/session/SessionProvider';
import { ApiError, NetworkError } from '@/services/api';
import { createDirect, directWith, KeyChangedError } from '@/services/groups';
import { CodeEntry } from '@/ui/CodeEntry';
import { NamePlate } from '@/ui/InviteCode';
import { Working } from '@/ui/Working';
import { colors, space, type } from '@/ui/theme';

/*
 * A private conversation with a member of one of our groups (group settings,
 * "Écrire en privé"). If there is already one between us, it opens. Otherwise
 * a code is chosen, twice: it locks the conversation on this phone only (the
 * other one chooses their own when it reaches them). The key is drawn here and
 * sealed to both of us; the server never gets a code.
 */
type Step = { kind: 'looking' } | { kind: 'code'; notice?: string } | { kind: 'confirm'; code: string } | { kind: 'failed'; message: string };

export default function NewDirect() {
  const { peer } = useLocalSearchParams<{ peer: string }>();
  const { session, profiles, openGroups } = useUnlocked();
  const router = useRouter();
  const [step, setStep] = useState<Step>({ kind: 'looking' });
  const [name, setName] = useState<string | null>(null);

  const open = (id: string) => router.replace({ pathname: '/group/[id]', params: { id } });

  useEffect(() => {
    let live = true;
    (async () => {
      const known = (await profiles.get([peer])).get(peer);
      if (!live) return;
      if (!known) return setStep({ kind: 'failed', message: 'Ce membre est introuvable.' });
      setName(known.username);
      const existing = await directWith(session, peer);
      if (!live) return;
      if (existing) open(existing);
      else setStep({ kind: 'code' });
    })().catch((e) => live && setStep({ kind: 'failed', message: e instanceof NetworkError ? 'Pas de réseau.' : 'Impossible d’ouvrir la discussion.' }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, for this person
  }, [session, profiles, peer]);

  if (step.kind === 'looking') {
    return (
      <View style={styles.center}>
        <Working />
      </View>
    );
  }

  if (step.kind === 'failed') {
    return (
      <View style={[styles.center, styles.padded]}>
        <Text style={type.heading}>Discussion impossible</Text>
        <Text style={[type.dim, styles.centerText]}>{step.message}</Text>
      </View>
    );
  }

  const header = name ? <NamePlate label="Tête-à-tête" name={name} /> : undefined;

  if (step.kind === 'code') {
    return (
      <View style={styles.center}>
        <CodeEntry
          key="code"
          header={header}
          initialError={step.notice}
          subtitle="Discussion chiffrée pour vous deux seulement. Choisis un code pour la verrouiller sur ce téléphone : il ne quitte jamais le téléphone."
          onComplete={async (code) => {
            setStep({ kind: 'confirm', code });
            return null;
          }}
        />
      </View>
    );
  }

  return (
    <View style={styles.center}>
      <CodeEntry
        key="confirm"
        header={header}
        title="Confirme le code"
        holdOnSuccess
        busyLabel="Chiffrement de la discussion…"
        onComplete={async (code) => {
          if (code !== step.code) {
            setStep({ kind: 'code', notice: 'Les codes ne correspondent pas' });
            return null;
          }
          try {
            const created = await createDirect(session, profiles, peer, code);
            openGroups.set(created.id, { keys: new Map([[1, created.groupKey]]), keyVersion: 1, name: created.name, direct: true });
            return () => open(created.id);
          } catch (e) {
            // Opened by the other one meanwhile: theirs it is.
            if (e instanceof ApiError && e.code === 'direct_exists') {
              const existing = await directWith(session, peer).catch(() => null);
              if (existing) return () => open(existing);
            }
            setStep({
              kind: 'failed',
              message:
                e instanceof KeyChangedError
                  ? 'Ses clés ont changé depuis que ce téléphone les a vues : vérifie son numéro de sécurité avant.'
                  : e instanceof NetworkError
                    ? 'Pas de réseau.'
                    : e instanceof ApiError && e.status === 404
                      ? 'Vous n’êtes plus dans un même groupe.'
                      : 'Impossible d’ouvrir la discussion.',
            });
            return null;
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  padded: { padding: space.lg, gap: space.md },
  centerText: { textAlign: 'center' },
});
