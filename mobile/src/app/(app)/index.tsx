import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useUnlocked } from '@/session/SessionProvider';
import { NetworkError } from '@/services/api';
import { listGroups, type GroupListItem } from '@/services/groups';
import { colors, space, type } from '@/ui/theme';

// SPEC §2.2: every group shows a lock and no message preview while locked.
export default function GroupsList() {
  const { session, openGroups } = useUnlocked();
  const router = useRouter();
  const [groups, setGroups] = useState<GroupListItem[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [offline, setOffline] = useState(false);

  const load = useCallback(async () => {
    try {
      setGroups(await listGroups(session));
      setOffline(false);
    } catch (e) {
      if (e instanceof NetworkError) setOffline(true);
      else throw e;
    }
  }, [session]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <View style={styles.headerButtons}>
              <HeaderButton label="⚙" onPress={() => router.push('/settings')} />
              <HeaderButton label="+" onPress={() => router.push('/group/new')} />
            </View>
          ),
        }}
      />
      {offline ? <Text style={styles.banner}>Hors ligne — la liste se mettra à jour au retour du réseau</Text> : null}
      <FlatList
        data={groups ?? []}
        keyExtractor={(g) => g.id}
        refreshControl={
          <RefreshControl
            tintColor={colors.gold}
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
              <Text style={[type.dim, styles.centerText]}>Crée un groupe, ou rejoins celui d’un pote avec son identifiant et son code.</Text>
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
          return (
            <Pressable
              style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surface2 }]}
              onPress={() => router.push({ pathname: '/group/[id]', params: { id: item.id } })}
            >
              <View style={styles.icon}>
                <Text style={styles.iconText}>{open ? '🔓' : '🔒'}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={type.body}>{item.name ?? 'Groupe verrouillé'}</Text>
                <Text style={type.dim}>
                  {item.state.kind === 'waiting-key'
                    ? 'En attente de la clé d’un membre'
                    : item.state.kind === 'first-unlock'
                      ? 'Clé reçue — entre le code du groupe'
                      : item.role === 'admin'
                        ? 'Admin'
                        : 'Membre'}
                </Text>
              </View>
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

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  headerButtons: { flexDirection: 'row', gap: space.lg },
  headerButton: { color: colors.gold, fontSize: 26 },
  banner: { backgroundColor: colors.surface2, color: colors.textDim, padding: space.sm, textAlign: 'center', fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.md, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  icon: { width: 48, height: 48, borderRadius: 10, borderWidth: 1, borderColor: colors.gold, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  iconText: { fontSize: 20 },
  empty: { alignItems: 'center', gap: space.md, padding: space.xl, marginTop: space.xl },
  centerText: { textAlign: 'center' },
  link: { color: colors.gold, fontSize: 16, padding: space.md },
  footer: { alignItems: 'center' },
});
