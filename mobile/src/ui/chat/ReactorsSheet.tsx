import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Avatar, isAvatarId } from '../avatars';
import { labelText } from '../Label';
import { colors, fonts, space, steel } from '../theme';
import { ActionKey, ActionSheet } from './MessageActions';
import { ReactionIcon } from './ReactionKeys';
import { REACTION_LABELS } from './reactions';
import type { Reactor } from './useReactions';

const AVATAR = 30;

/** A long press on the reactions of a message or a story: who gave which one, a line each. */
export function ReactorsSheet({ reactors, onClose }: { reactors: Reactor[] | null; onClose(): void }) {
  return (
    <ActionSheet visible={reactors !== null} onClose={onClose}>
      <Text style={styles.title}>RÉACTIONS · {reactors?.length ?? 0}</Text>
      <ScrollView style={styles.list} contentContainerStyle={styles.rows}>
        {reactors?.map((r) => (
          <View key={r.senderId} style={styles.row} accessible accessibilityLabel={`${r.name} : ${REACTION_LABELS[r.reaction]}`}>
            <Avatar id={isAvatarId(r.avatar) ? r.avatar : null} size={AVATAR} color={r.color} />
            <Text style={styles.name} numberOfLines={1}>
              {r.name}
            </Text>
            <View style={styles.key}>
              <ReactionIcon id={r.reaction} size={18} />
            </View>
          </View>
        ))}
      </ScrollView>
      <ActionKey label="Fermer" dim onPress={onClose} />
    </ActionSheet>
  );
}

const styles = StyleSheet.create({
  title: { ...labelText, textAlign: 'center', marginBottom: space.xs },
  list: { maxHeight: 320 },
  rows: { gap: space.sm, paddingVertical: space.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  name: { flex: 1, color: colors.text, fontFamily: fonts.medium, fontSize: 15 },
  // The reaction on a small steel plate, as on the keys.
  key: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: steel.plate,
    borderWidth: 1,
    borderTopColor: steel.edgeLight,
    borderLeftColor: steel.edgeLight,
    borderBottomColor: steel.edgeDark,
    borderRightColor: steel.edgeDark,
  },
});
