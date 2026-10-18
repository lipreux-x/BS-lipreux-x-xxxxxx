import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useUnlocked } from '@/session/SessionProvider';
import { NetworkError } from '@/services/api';
import { groupInfo, type GroupInfo } from '@/services/groupInfo';
import { colors, space, type } from '@/ui/theme';

/** Group info sheet: members (admin first) and the 3 join keywords. Only reachable from an open group. */
export default function GroupInfoScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session, profiles } = useUnlocked();
  const [info, setInfo] = useState<GroupInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    groupInfo(session, profiles, id)
      .then(setInfo)
      .catch((e) => setError(e instanceof NetworkError ? 'Pas de réseau' : 'Impossible de charger la fiche'));
  }, [session, profiles, id]);

  if (!info) {
    return (
      <View style={styles.center}>
        {error ? <Text style={styles.error}>{error}</Text> : <ActivityIndicator color={colors.accentFg} />}
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {info.name ? <Stack.Screen options={{ title: info.name }} /> : null}

      <Text style={styles.section}>Mots-clés pour rejoindre</Text>
      <View style={styles.card}>
        {info.keywords ? (
          <View style={styles.keywords}>
            {info.keywords.map((k, i) => (
              <View key={i} style={styles.chip}>
                <Text style={styles.chipText}>{k}</Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={type.dim}>Aucun : ce groupe a été créé avant les mots-clés, le code suffit pour le rejoindre.</Text>
        )}
        <Text style={[type.dim, styles.note]}>À donner en vrai avec le code, jamais par message.</Text>
      </View>

      <Text style={styles.section}>Membres · {info.members.length}</Text>
      <View style={styles.card}>
        {info.members.map((m, i) => (
          <View key={m.userId} style={[styles.member, i > 0 && styles.divider]}>
            <View style={{ flex: 1 }}>
              <Text style={type.body}>
                {m.username}
                {m.me ? <Text style={type.dim}> (toi)</Text> : null}
              </Text>
              {!m.hasKey ? <Text style={type.dim}>En attente de la clé</Text> : null}
            </View>
            {m.role === 'admin' ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>Admin</Text>
              </View>
            ) : null}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.sm },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  error: { color: colors.danger },
  section: { color: colors.textDim, fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.8, marginTop: space.md },
  card: { backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: space.md },
  keywords: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: { backgroundColor: colors.accent, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  chipText: { color: colors.text, fontSize: 16, fontWeight: '600' },
  note: { marginTop: space.md, fontSize: 13 },
  member: { flexDirection: 'row', alignItems: 'center', paddingVertical: space.sm },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  badge: { borderWidth: 1, borderColor: colors.accentFg, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { color: colors.accentFg, fontSize: 12, fontWeight: '600' },
});
