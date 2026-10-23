import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Platform, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { wipe } from '@/crypto/encoding';
import { useUnlocked } from '@/session/SessionProvider';
import { NetworkError } from '@/services/api';
import { listGroups, type GroupListItem } from '@/services/groups';
import { setNotificationNames } from '@/services/push';
import { countdownLabel } from '@/ui/chat/timeline';
import { LCD_ON } from '@/ui/InviteCode';
import { colors, led, space, type } from '@/ui/theme';
import { Wordmark } from '@/ui/Wordmark';

// SPEC §2.2: every group shows a lock and no message preview while locked.
// Each group is a safe: same status LED as the code display (blue open, pale key received, red closed),
// and the same word under its name: "Ouvert" in blue, "Fermé" in red. The
// groups opened last come first; lit digits on the right, like an invitation
// code, count the messages waiting inside, locked or not (a number, never a
// word of them).
export default function GroupsList() {
  // groupsVersion: re-render when groups close on their own (10 min out of them).
  const { session, openGroups, groupsVersion } = useUnlocked();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [groups, setGroups] = useState<GroupListItem[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Why the last refresh failed: no network, or the server answered an error.
  const [problem, setProblem] = useState<'offline' | 'error' | null>(null);

  const load = useCallback(async () => {
    try {
      const { items: list, offline } = await listGroups(session);
      // Groups gone from the server (self-destructed, removed): their keys leave memory too.
      const alive = new Set(list.map((g) => g.id));
      for (const [id, g] of openGroups) {
        if (alive.has(id)) continue;
        for (const k of g.keys.values()) wipe(k);
        openGroups.delete(id);
      }
      setGroups(list);
      setProblem(offline ? 'offline' : null);
      // Notifications name the group as this phone knows it.
      void setNotificationNames(Object.fromEntries(list.map((g) => [g.id, g.name])));
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
        extraData={groupsVersion}
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
        // Edge to edge: "Rejoindre un groupe" stays above the navigation bar / home indicator.
        contentContainerStyle={{ paddingBottom: insets.bottom }}
        refreshControl={
          <RefreshControl
            tintColor={colors.accentFg}
            colors={[colors.accentFg]}
            progressBackgroundColor={colors.surface2}
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
          const closed = !open && item.state.kind === 'locked';
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
                <Text style={type.body}>{item.name ?? (item.state.kind === 'pending' ? 'Groupe demandé' : 'Groupe verrouillé')}</Text>
                <Text style={[type.dim, open ? styles.openText : closed && styles.closedText]}>
                  {open
                    ? 'Ouvert'
                    : item.state.kind === 'pending'
                      ? 'Demande envoyée — en attente d’un admin'
                      : item.state.kind === 'waiting-key'
                      ? 'En attente de la clé d’un admin'
                      : item.state.kind === 'first-unlock'
                        ? 'Clé reçue — entre le code du groupe'
                        : 'Fermé'}
                  {item.expiresAt ? <Text style={styles.expiry}>{`  ·  💣 ${countdownLabel(new Date(item.expiresAt), new Date())}`}</Text> : null}
                </Text>
              </View>
              {item.unread > 0 ? (
                // Messages waiting: lit digits, like an invitation code on the safe's screen.
                <Text style={styles.unread}>{item.unread > 99 ? '99+' : item.unread}</Text>
              ) : (
                <Text style={styles.chevron}>›</Text>
              )}
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

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  headerButtons: { flexDirection: 'row', gap: space.lg },
  headerButton: { color: colors.accentFg, fontSize: 26 },
  banner: { backgroundColor: colors.surface2, color: colors.textDim, padding: space.sm, textAlign: 'center', fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.md, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  icon: { width: 48, height: 48, borderRadius: 10, borderWidth: 1, borderColor: colors.accentFg, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  iconText: { fontSize: 20 },
  iconOpen: { borderColor: led.ok },
  // Status LED in the corner, like the one on the safe's code display.
  led: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: led.off,
    borderWidth: 1,
    borderColor: '#000000',
  },
  ledOpen: { backgroundColor: led.ok, boxShadow: `0 0 4px ${led.ok}` },
  ledKey: { backgroundColor: led.busy, boxShadow: `0 0 4px ${led.busy}` },
  openText: { color: led.ok },
  closedText: { color: colors.danger },
  ledClosed: { backgroundColor: colors.danger, boxShadow: `0 0 4px ${colors.danger}` },
  chevron: { color: colors.textDim, fontSize: 24 },
  unread: { color: LCD_ON, fontFamily: MONO, fontSize: 18, letterSpacing: 1, textShadowColor: LCD_ON, textShadowRadius: 6 },
  expiry: { color: colors.textDim },
  section: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: space.md, paddingTop: space.md, paddingBottom: space.sm },
  sectionLabel: { color: colors.textDim, fontFamily: MONO, fontSize: 12, letterSpacing: 2, textTransform: 'uppercase' },
  empty: { alignItems: 'center', gap: space.md, padding: space.xl, marginTop: space.xl },
  centerText: { textAlign: 'center' },
  link: { color: colors.accentFg, fontSize: 16, padding: space.md },
  footer: { alignItems: 'center' },
});
