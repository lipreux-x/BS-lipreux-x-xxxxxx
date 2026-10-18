import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from './theme';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'] as const;

export function PinPad({ onDigit, onDelete, disabled }: { onDigit(d: string): void; onDelete(): void; disabled?: boolean }) {
  return (
    <View style={styles.grid}>
      {KEYS.map((k, i) =>
        k === '' ? (
          <View key={i} style={styles.key} />
        ) : (
          <Pressable
            key={i}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={k === '⌫' ? 'Effacer' : k}
            onPress={() => {
              void Haptics.selectionAsync();
              if (k === '⌫') onDelete();
              else onDigit(k);
            }}
            style={({ pressed }) => [styles.key, styles.button, pressed && styles.pressed, disabled && styles.disabled]}
          >
            <Text style={[styles.label, k === '⌫' && styles.del]}>{k}</Text>
          </Pressable>
        ),
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', width: 288, justifyContent: 'space-between', rowGap: 16 },
  key: { width: 80, height: 80, alignItems: 'center', justifyContent: 'center' },
  button: { borderRadius: 40, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  pressed: { backgroundColor: colors.surface2, borderColor: colors.accentFg },
  disabled: { opacity: 0.3 },
  label: { color: colors.text, fontSize: 32, fontWeight: '300' },
  del: { fontSize: 24, color: colors.textDim },
});
