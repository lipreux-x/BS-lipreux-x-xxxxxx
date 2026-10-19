import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Avatar, AVATAR_LABELS, AVATARS, type AvatarId } from './avatars';
import { colors, space } from './theme';

const CHOICES: (AvatarId | null)[] = [null, ...AVATARS];

/** Grid of the avatar icons: the default silhouette first, then the heist set (4 per row). */
export function AvatarPicker({ value, onChange, disabled }: { value: AvatarId | null; onChange(id: AvatarId | null): void; disabled?: boolean }) {
  return (
    <View style={styles.grid}>
      {CHOICES.map((id) => {
        const selected = id === value;
        const label = AVATAR_LABELS[id ?? 'default'];
        return (
          <Pressable
            key={id ?? 'default'}
            disabled={disabled}
            accessibilityRole="radio"
            accessibilityState={{ selected, disabled }}
            accessibilityLabel={label}
            onPress={() => {
              if (selected) return;
              void Haptics.selectionAsync();
              onChange(id);
            }}
            style={({ pressed }) => [styles.cell, pressed && { transform: [{ translateY: 1 }] }, disabled && { opacity: 0.5 }]}
          >
            <Avatar id={id} size={56} selected={selected} />
            <Text style={[styles.label, selected && styles.labelOn]} numberOfLines={1}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: space.md },
  cell: { width: '25%', alignItems: 'center', gap: 4 },
  label: { color: colors.textDim, fontSize: 11, textAlign: 'center' },
  labelOn: { color: colors.text },
});
