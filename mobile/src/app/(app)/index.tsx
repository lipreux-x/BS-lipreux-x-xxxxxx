import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Platform, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { wipe } from '@/crypto/encoding';
import { useUnlocked } from '@/session/SessionProvider';
import { NetworkError } from '@/services/api';
import { listGroups, type GroupListItem } from '@/services/groups';
import { countdownLabel } from '@/ui/chat/timeline';
import { colors, space, type } from '@/ui/theme';
import { Wordmark } from '@/ui/Wordmark';

// SPEC §2.2: every group shows a lock and no message preview while locked.
// Each group is a safe: same status LED as the code display (green open, amber key received, red closed),
// and the same word under its name: "Ouvert" in green, "Fermé" in red.
export default function GroupsList() {
  const { session, openGroups } = useUnlocked();
  const router = useRouter();
  const [groups, setGroups] = useState<GroupListItem[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Why the last refresh failed: no network, or the server answered an error.
  const [problem, setProblem] = useState<'offline' | 'error' | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await listGroups(session);
      // Groups gone from the server (self-destructed, removed): their keys leave memory too.
      const alive = new Set(list.map((g) => g.id));
      for (const [id, g] of openGroups) {
        if (alive.has(id)) continue;
        for (const k of g.keys.values()) wipe(k);
        openGroups.delete(id);
      }
      setGroups(list);
      setProblem(null);
    } catch (e) {
      setProblem(e instanceof NetworkError ? 'offline' : 'error');
    }
  }, [session, openGroups]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          headerTitle: () => <Wordmark size={18} />,
          headerRight: () => (
            <View style={styles.headerButtons}>
              <HeaderButton label="⚙" onPress={() => router.push('/settings')} />
              <HeaderButton label="+" onPress={() => router.push('/group/new')} />
            </View>
          ),
        }}
      />
      {problem ? (
        <Text style={styles.banner}>
          {problem === 'offline'
            ? 'Hors ligne — la liste se mettra à jour au retour du réseau'
            : 'Impossible de mettre à jour la liste — tire vers le bas pour réessayer'}
        </Text>
      ) : null}
      <FlatList
        data={groups ?? []}
        keyExtractor={(g) => g.id}
        ListHeaderComponent={
          groups?.length ? (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Coffres</Text>
              <Text style={styles.sectionLabel}>
                {openGroups.size > 0 ? `${groups.filter((g) => openGroups.has(g.id)).length} ouvert · ` : ''}
                {groups.length}
              </Text>
            </View>
          ) : undefined
        }
        refreshControl={
          <RefreshControl
            tintColor={colors.accentFg}
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
          />
        }
        ListEmptyComponent={
          groups ? (
            <View style={styles.empty}>
              <Text style={type.heading}>Aucun groupe</Text>
              <Text style={[type.dim, styles.centerText]}>Crée un groupe, ou rejoins celui d’un pote avec son code.</Text>
              <Pressable onPress={() => router.push('/group/join')}>
                <Text style={styles.link}>Rejoindre un groupe</Text>
              </Pressable>
            </View>
          ) : undefined
        }
        ListFooterComponent={
          groups?.length ? (
            <Pressable onPress={() => router.push('/group/join')} style={styles.footer}>
              <Text style={styles.link}>Rejoindre un groupe</Text>
            </Pressable>
          ) : undefined
        }
        renderItem={({ item }) => {
          const open = openGroups.has(item.id);
          const closed = !open && item.state.kind !== 'waiting-key' && item.state.kind !== 'first-unlock';
          return (
            <Pressable
              style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surface2 }]}
              onPress={() => router.push({ pathname: '/group/[id]', params: { id: item.id } })}
            >
              <View style={[styles.icon, open && styles.iconOpen]}>
                <Text style={styles.iconText}>{open ? '🔓' : '🔒'}</Text>
                <View style={[styles.led, open ? styles.ledOpen : closed ? styles.ledClosed : item.state.kind === 'first-unlock' && styles.ledKey]} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={type.body}>{item.name ?? 'Groupe verrouillé'}</Text>
                <Text style={[type.dim, open ? styles.openText : closed && styles.closedText]}>
                  {open
                    ? 'Ouvert'
                    : item.state.kind === 'waiting-key'
                      ? 'En attente de la clé d’un membre'
                      : item.state.kind === 'first-unlock'
                        ? 'Clé reçue — entre le code du groupe'
                        : 'Fermé'}
                  {item.expiresAt ? <Text style={styles.expiry}>{`  ·  💣 ${countdownLabel(new Date(item.expiresAt), new Date())}`}</Text> : null}
                </Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

function HeaderButton({ label, onPress }: { label: string; onPress(): void }) {
  return (
    <Pressable onPress={onPress} hitSlop={12} accessibilityRole="button">
      <Text style={styles.headerButton}>{label}</Text>
    </Pressable>
  );
}

const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });
const LED_GREEN = '#3DD68C';
const LED_AMBER = '#E8A33D';

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  headerButtons: { flexDirection: 'row', gap: space.lg },
  headerButton: { color: colors.accentFg, fontSize: 26 },
  banner: { backgroundColor: colors.surface2, color: colors.textDim, padding: space.sm, textAlign: 'center', fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.md, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  icon: { width: 48, height: 48, borderRadius: 10, borderWidth: 1, borderColor: colors.accentFg, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  iconText: { fontSize: 20 },
  iconOpen: { borderColor: colors.forest },
  // Status LED in the corner, like the one on the safe's code display.
  led: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#2E2E2E',
    borderWidth: 1,
    borderColor: '#000000',
  },
  ledOpen: { backgroundColor: LED_GREEN, shadowColor: LED_GREEN, shadowOpacity: 0.9, shadowRadius: 4, shadowOffset: { width: 0, height: 0 } },
  ledKey: { backgroundColor: LED_AMBER, shadowColor: LED_AMBER, shadowOpacity: 0.9, shadowRadius: 4, shadowOffset: { width: 0, height: 0 } },
  openText: { color: LED_GREEN },
  closedText: { color: colors.danger },
  ledClosed: { backgroundColor: colors.danger, shadowColor: colors.danger, shadowOpacity: 0.9, shadowRadius: 4, shadowOffset: { width: 0, height: 0 } },
  chevron: { color: colors.textDim, fontSize: 24 },
  expiry: { color: colors.textDim },
  section: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: space.md, paddingTop: space.md, paddingBottom: space.sm },
  sectionLabel: { color: colors.textDim, fontFamily: MONO, fontSize: 12, letterSpacing: 2, textTransform: 'uppercase' },
  empty: { alignItems: 'center', gap: space.md, padding: space.xl, marginTop: space.xl },
  centerText: { textAlign: 'center' },
  link: { color: colors.accentFg, fontSize: 16, padding: space.md },
  footer: { alignItems: 'center' },
});
