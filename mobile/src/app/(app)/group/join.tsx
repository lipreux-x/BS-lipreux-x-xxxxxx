import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useUnlocked } from '@/session/SessionProvider';
import { ApiError, NetworkError } from '@/services/api';
import { joinGroup } from '@/services/groups';
import { CodeEntry } from '@/ui/CodeEntry';
import { colors } from '@/ui/theme';

/*
 * Key flow: the code alone identifies the group. The server checks it
 * (5 tries/hour) and adds us as member. The group key is NOT sent here: a
 * member who has it seals it to our public key the next time they open the
 * group.
 */
export default function JoinGroup() {
  const { session } = useUnlocked();
  const router = useRouter();

  return (
    <View style={styles.center}>
      <CodeEntry
        title="Code du groupe"
        subtitle="Demande-le à un membre, en vrai."
        onComplete={async (code) => {
          try {
            const id = await joinGroup(session, code);
            router.replace({ pathname: '/group/[id]', params: { id } });
            return null;
          } catch (e) {
            if (e instanceof NetworkError) return 'Pas de réseau';
            if (e instanceof ApiError && e.code === 'wrong_code') return 'Aucun groupe avec ce code';
            if (e instanceof ApiError && e.code === 'too_many_attempts') return 'Trop d’essais. Réessaie dans une heure.';
            return 'Impossible de rejoindre';
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
});
