import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { Bomb, LockKeyhole, LockKeyholeOpen, MessageSquareLock, Plus, Settings, type LucideIcon } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewInstance,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { wipe } from '@/crypto/encoding';
import { useUnlocked } from '@/session/SessionProvider';
import { NetworkError } from '@/services/api';
import { listedGroups, listGroups, plateName, type GroupListItem } from '@/services/groups';
import { setNotificationNames } from '@/services/push';
import { Button } from '@/ui/Button';
import { countdownLabel } from '@/ui/chat/timeline';
import { Label, labelText } from '@/ui/Label';
import { Led, type LedState } from '@/ui/Led';
import { screenStyle } from '@/ui/Screen';
import { Segment } from '@/ui/Segment';
import { bevel, colors, fonts, lcd, led, mono, neon, space, steel, type } from '@/ui/theme';
import { Wordmark } from '@/ui/Wordmark';
import { Working } from '@/ui/Working';

// SPEC §2.2: every group shows a lock and no message preview while locked.
// The list is a panel of the safe: each group a steel plate with, on a small
// recessed screen, its lock (open in the cold light, shut in the red one)
// and the same status LED as the code display (blue open, pale key received,
// red closed). Under its name, the state engraved in capitals, lit when it
// matters ("OUVERT" in blue, "FERMÉ" in red). The groups opened last come
// first; lit digits on the right, like an invitation code, count the messages
// waiting inside, locked or not (a number, never a word of them).
//
// Two spaces, side by side: the groups, and the private conversations (two
// people, opened from a group's sheet). Switched by the keys at the top, or by
// sliding the list sideways; each key counts what waits in its space.
type Space = 'groups' | 'direct';

/** The space last shown, kept while the app is unlocked (back on this screen, it is the same). */
let lastSpace: Space = 'groups';

export default function GroupsList() {
  // groupsVersion: re-render when groups close on their own (10 min out of them).
  const { session, profiles, openGroups, groupsVersion } = useUnlocked();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // The last list of this session at once (back on this screen), refreshed below.
  const [groups, setGroups] = useState<GroupListItem[] | null>(() => listedGroups(session) ?? null);
  const [refreshing, setRefreshing] = useState(false);
  // Why the last refresh failed: no network, or the server answered an error.
  const [problem, setProblem] = useState<'offline' | 'error' | null>(null);
  const [shownSpace, setSpace] = useState<Space>(lastSpace);
  const { width } = useWindowDimensions();
  const pager = useRef<ScrollViewInstance>(null);
  // How far the pages have slid (0 = groups, `width` = private): the keys' blue plate glides along with it.
  const [slid] = useState(() => new Animated.Value(lastSpace === 'direct' ? width : 0));
  const slide = useMemo(() => Animated.divide(slid, width), [slid, width]);
  // A key pressed: the space it asked for, while the pages slide over to it (the one passed on the way is not chosen).
  const target = useRef<Space | null>(null);
  const show = setSpace;
  useEffect(() => {
    lastSpace = shownSpace;
  }, [shownSpace]);
  const choose = (s: Space) => {
    show(s);
    target.current = s;
    pager.current?.scrollTo({ x: s === 'direct' ? width : 0, animated: true });
  };
  // Slid by the finger: the key follows as soon as the other page is more than half in.
  const onSlide = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const s: Space = Math.round(e.nativeEvent.contentOffset.x / width) === 1 ? 'direct' : 'groups';
    if (target.current) {
      if (s === target.current) target.current = null;
      return;
    }
    if (s !== shownSpace) show(s);
  };

  const load = useCallback(async () => {
    try {
      const { items: list, offline } = await listGroups(session, profiles);
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
  }, [session, profiles, openGroups]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const waiting = (d: boolean) => groups?.filter((g) => g.direct === d).reduce((n, g) => n + g.unread, 0) ?? 0;
  const keyLabel = (label: string, d: boolean) => (waiting(d) > 0 ? `${label} · ${waiting(d) > 99 ? '99+' : waiting(d)}` : label);

  // A space's page: its list, side by side with the other one in the pager.
  const page = (direct: boolean) => {
    const shown = groups?.filter((g) => g.direct === direct) ?? null;
    const openCount = shown?.filter((g) => openGroups.has(g.id)).length ?? 0;
    return (
          <FlatList
            style={{ width }}
            data={shown ?? []}
            keyExtractor={(g) => g.id}
            extraData={groupsVersion}
            ListHeaderComponent={
              shown?.length ? (
                <View style={styles.section}>
                  <Label icon={direct ? MessageSquareLock : LockKeyhole}>{direct ? 'Discussions privées' : 'Groupes'}</Label>
                  <Text style={labelText}>{openCount > 0 ? `${openCount} ouvert · ${shown.length}` : `${shown.length}`}</Text>
                </View>
              ) : undefined
            }
            // Edge to edge: "Rejoindre un groupe" stays above the navigation bar / home indicator.
            contentContainerStyle={{ paddingBottom: insets.bottom + space.md }}
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
              groups && direct ? (
                <View style={styles.empty}>
                  <View style={styles.emptyScreen}>
                    <MessageSquareLock size={34} color={lcd.off} strokeWidth={1.75} />
                  </View>
                  <Text style={type.heading}>Aucune discussion privée</Text>
                  <Text style={[type.dim, styles.centerText]}>
                    Pour écrire à une seule personne : ouvre un groupe où vous êtes tous les deux, puis sa fiche (la roue dentée), et touche la bulle à
                    cadenas à côté de son nom. La discussion est chiffrée pour vous deux, et chacun la verrouille avec son propre code.
                  </Text>
                </View>
              ) : groups ? (
                <View style={styles.empty}>
                  <View style={styles.emptyScreen}>
                    <LockKeyhole size={34} color={lcd.off} strokeWidth={1.75} />
                  </View>
                  <Text style={type.heading}>Aucun groupe</Text>
                  <Text style={[type.dim, styles.centerText]}>Crée un groupe, ou rejoins celui d’un pote avec son code et ses mots-clés.</Text>
                  <View style={styles.emptyKeys}>
                    <Button title="Créer un groupe" onPress={() => router.push('/group/new')} />
                    <Button title="Rejoindre un groupe" variant="ghost" onPress={() => router.push('/group/join')} />
                  </View>
                </View>
              ) : undefined
            }
            ListFooterComponent={
              shown?.length ? (
                <View style={styles.footer}>
                  {direct ? null : <Button title="Rejoindre un groupe" variant="ghost" onPress={() => router.push('/group/join')} />}
                  <Text style={styles.engraving}>CHIFFRÉ DE BOUT EN BOUT · XCHACHA20-POLY1305</Text>
                </View>
              ) : undefined
            }
            renderItem={({ item }) => <GroupPlate item={item} open={openGroups.has(item.id)} onPress={() => router.push({ pathname: '/group/[id]', params: { id: item.id } })} />}
          />
    );
  };

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          headerTitle: () => <Wordmark size={18} />,
          headerRight: () => (
            <View style={styles.headerButtons}>
              <HeaderButton icon={Settings} label="Réglages" onPress={() => router.push('/settings')} />
              {shownSpace === 'direct' ? null : <HeaderButton icon={Plus} label="Nouveau groupe" onPress={() => router.push('/group/new')} />}
            </View>
          ),
        }}
      />
      {problem ? (
        <View style={styles.banner}>
          <Led state={problem === 'offline' ? 'busy' : 'error'} size={7} />
          <Text style={styles.bannerText}>
            {problem === 'offline' ? 'HORS LIGNE · LA LISTE SE METTRA À JOUR AU RETOUR DU RÉSEAU' : 'LISTE NON MISE À JOUR · TIRE VERS LE BAS POUR RÉESSAYER'}
          </Text>
        </View>
      ) : null}
      <View style={styles.spaces}>
        <Segment
          options={[
            { label: keyLabel('Groupes', false), value: 'groups' as const },
            { label: keyLabel('Privé', true), value: 'direct' as const },
          ]}
          value={shownSpace}
          onChange={choose}
          slide={slide}
        />
      </View>
      <Animated.ScrollView
        ref={pager}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        // The listener reads `target` only while the pages slide, never during render.
        // eslint-disable-next-line react-hooks/refs
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: slid } } }], { useNativeDriver: true, listener: onSlide })}
        onScrollBeginDrag={() => (target.current = null)}
        // On the space last shown (back on this screen), and still on it after a rotation.
        onLayout={() => pager.current?.scrollTo({ x: shownSpace === 'direct' ? width : 0, animated: false })}
      >
        {page(false)}
        {page(true)}
      </Animated.ScrollView>
      {/* First list since the app opened: the blade turning until it is there, not an empty screen. */}
      {!groups && !problem ? <Working style={styles.loading} /> : null}
    </View>
  );
}

/** What the plate says of the group's state: the word engraved in capitals, and the lit one after it. */
function stateOf(item: GroupListItem, open: boolean): { word: string; hint?: string; led: LedState; lit?: 'ok' | 'error' } {
  if (open) return { word: 'Ouvert', led: 'ok', lit: 'ok' };
  switch (item.state.kind) {
    case 'pending':
      return { word: 'Demande envoyée', hint: 'attend un admin', led: 'off' };
    case 'waiting-key':
      return { word: 'En attente', hint: 'de la clé d’un admin', led: 'off' };
    case 'first-unlock':
      return item.direct
        ? { word: 'Nouvelle', hint: 'choisis ton code', led: 'busy' }
        : { word: 'Clé reçue', hint: 'tape le code du groupe', led: 'busy' };
    default:
      return { word: 'Fermé', led: 'error', lit: 'error' };
  }
}

function GroupPlate({ item, open, onPress }: { item: GroupListItem; open: boolean; onPress(): void }) {
  const state = stateOf(item, open);
  const name = plateName(item) ?? (item.direct ? 'Discussion verrouillée' : item.state.kind === 'pending' ? 'Groupe demandé' : 'Groupe verrouillé');
  const litColor = state.lit === 'ok' ? led.ok : state.lit === 'error' ? colors.danger : undefined;
  return (
    <Pressable
      style={({ pressed }) => [styles.plate, pressed && styles.platePressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${state.word}${state.hint ? `, ${state.hint}` : ''}${item.unread > 0 ? `, ${item.unread} messages en attente` : ''}`}
    >
      <View style={styles.lockScreen}>
        {open ? <LockKeyholeOpen size={22} color={led.ok} strokeWidth={2} /> : <LockKeyhole size={22} color={litColor ?? lcd.off} strokeWidth={2} />}
        <View style={styles.ledCorner}>
          <Led state={state.led} size={7} />
        </View>
      </View>
      <View style={styles.text}>
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>
        <View style={styles.stateRow}>
          <Text style={[styles.state, litColor && { color: litColor, ...neon.text(litColor, 6) }]}>{state.word.toUpperCase()}</Text>
          {state.hint ? <Text style={styles.hint}>· {state.hint}</Text> : null}
          {item.expiresAt ? (
            <>
              <Bomb size={11} color={colors.textDim} strokeWidth={2.25} />
              <Text style={styles.hint}>{countdownLabel(new Date(item.expiresAt), new Date())}</Text>
            </>
          ) : null}
        </View>
      </View>
      {item.unread > 0 ? (
        // Messages waiting: lit digits, like an invitation code on the safe's screen.
        <Text style={styles.unread}>{item.unread > 99 ? '99+' : item.unread}</Text>
      ) : null}
    </Pressable>
  );
}

function HeaderButton({ icon: Icon, label, onPress }: { icon: LucideIcon; label: string; onPress(): void }) {
  return (
    <Pressable onPress={onPress} hitSlop={12} accessibilityRole="button" accessibilityLabel={label}>
      <Icon size={22} color={colors.accentFg} strokeWidth={2} />
    </Pressable>
  );
}

const LOCK_SCREEN = 44;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  loading: { backgroundColor: colors.bg },
  headerButtons: { flexDirection: 'row', gap: space.lg },
  spaces: { paddingHorizontal: space.md, paddingTop: space.md },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 6,
    paddingHorizontal: space.md,
    backgroundColor: colors.surface2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  bannerText: { ...labelText, letterSpacing: 1, fontSize: 10, flexShrink: 1, textAlign: 'center' },
  section: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: space.md + 4, paddingTop: space.md, paddingBottom: space.sm },
  // A steel plate per group, bevelled like a key; pressed, it sinks in.
  plate: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginHorizontal: space.md,
    marginBottom: space.sm,
    padding: 10,
    borderRadius: 10,
    backgroundColor: steel.plate,
    borderWidth: 1,
    ...bevel(steel.edgeLight, steel.edgeDark),
  },
  platePressed: { backgroundColor: steel.keyPressed, ...bevel(steel.edgeLight, steel.edgeDark, true), transform: [{ translateY: 1 }] },
  // The lock on a small recessed screen, the status LED in its corner.
  lockScreen: { ...screenStyle, width: LOCK_SCREEN, height: LOCK_SCREEN, alignItems: 'center', justifyContent: 'center' },
  ledCorner: { position: 'absolute', top: 3, right: 3 },
  text: { flex: 1, gap: 3 },
  name: { color: colors.text, fontSize: 16, fontFamily: fonts.semibold },
  stateRow: { flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' },
  state: { fontFamily: mono, fontSize: 11, letterSpacing: 1.5, color: colors.textDim },
  hint: { fontFamily: mono, fontSize: 11, color: colors.textDim },
  unread: { color: lcd.on, fontFamily: mono, fontSize: 18, letterSpacing: 1, paddingRight: 4, ...neon.text(lcd.on, 6) },
  empty: { alignItems: 'center', gap: space.md, padding: space.xl, marginTop: space.xl },
  emptyScreen: { ...screenStyle, width: 72, height: 72, alignItems: 'center', justifyContent: 'center', marginBottom: space.sm },
  emptyKeys: { alignSelf: 'stretch', gap: space.sm, marginTop: space.sm },
  centerText: { textAlign: 'center' },
  footer: { paddingHorizontal: space.md, paddingTop: space.md, gap: space.md, alignItems: 'stretch' },
  // Engraved under the list: what the safe does, in one line (crypto/aead.ts).
  engraving: { ...labelText, fontSize: 10, letterSpacing: 1.5, textAlign: 'center' },
});
