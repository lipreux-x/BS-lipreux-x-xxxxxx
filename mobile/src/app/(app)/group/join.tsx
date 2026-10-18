import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { useUnlocked } from '@/session/SessionProvider';
import { ApiError, NetworkError } from '@/services/api';
import { joinGroup } from '@/services/groups';
import { Button } from '@/ui/Button';
import { CodeEntry } from '@/ui/CodeEntry';
import { colors, space, type } from '@/ui/theme';

/*
 * Key flow: the server checks the code (5 tries/hour) and adds us as member.
 * The group key is NOT sent here: a member who has it seals it to our public
 * key the next time they open the group.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export default function JoinGroup() {
  const { session } = useUnlocked();
  const router = useRouter();
  const [groupId, setGroupId] = useState('');
  const [step, setStep] = useState<'id' | 'code'>('id');
  const id = groupId.trim().toLowerCase();

  if (step === 'code') {
    return (
      <View style={styles.center}>
        <CodeEntry
          title="Code du groupe"
          subtitle="Demande-le à un membre, en vrai."
          onComplete={async (code) => {
            try {
              await joinGroup(session, id, code);
              router.back();
              return null;
            } catch (e) {
              if (e instanceof NetworkError) return 'Pas de réseau';
              if (e instanceof ApiError && e.code === 'wrong_code') return 'Code ou identifiant incorrect';
              if (e instanceof ApiError && e.code === 'too_many_attempts') return 'Trop d’essais. Réessaie dans une heure.';
              return 'Impossible de rejoindre';
            }
          }}
        />
      </View>
    );
  }

  return (
    <View style={styles.form}>
      <Text style={type.dim}>Colle l’identifiant du groupe qu’un membre t’a envoyé.</Text>
      <TextInput
        value={groupId}
        onChangeText={setGroupId}
        placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
        placeholderTextColor={colors.textDim}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.input}
      />
      <Button title="Coller" variant="ghost" onPress={async () => setGroupId(await Clipboard.getStringAsync())} />
      <Button title="Continuer" disabled={!UUID.test(id)} onPress={() => setStep('code')} />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  form: { flex: 1, backgroundColor: colors.bg, padding: space.lg, gap: space.md },
  input: { height: 52, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, color: colors.text, paddingHorizontal: space.md, fontSize: 14 },
});
