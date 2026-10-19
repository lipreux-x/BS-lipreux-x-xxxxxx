import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Button } from './Button';
import { countdownLabel, dateTimeLabel } from './chat/timeline';
import { colors, fonts, space, type } from './theme';

export const MAX_LIFETIME_DAYS = 365;

const PRESETS: { label: string; days: number | null }[] = [
  { label: 'Permanent', days: null },
  { label: '24 h', days: 1 },
  { label: '3 jours', days: 3 },
  { label: '1 semaine', days: 7 },
  { label: '1 mois', days: 30 },
];

/**
 * Group lifetime at creation: permanent, or a self-destruct date a whole
 * number of days from now (presets, then ± one day). `onSubmit` gets the
 * number of days, or null for a permanent group.
 */
export function LifetimePicker({ initial, onSubmit }: { initial: number | null; onSubmit(days: number | null): void }) {
  const [days, setDays] = useState<number | null>(initial);
  const now = new Date();
  const end = days === null ? null : new Date(now.getTime() + days * 86_400_000);

  return (
    <View style={styles.form}>
      <Text style={type.dim}>
        Un groupe éphémère s’autodétruit à la date choisie : le groupe, ses messages et ses photos sont effacés de partout, pour tous les membres.
      </Text>
      <View style={styles.presets}>
        {PRESETS.map((p) => {
          const on = days === p.days;
          return (
            <Pressable
              key={p.label}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              onPress={() => setDays(p.days)}
              style={[styles.option, on && styles.optionOn]}
            >
              <Text style={[styles.optionText, on && styles.optionTextOn]}>{p.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {end ? (
        <View style={styles.card}>
          <Text style={styles.caption}>AUTODESTRUCTION</Text>
          <View style={styles.stepper}>
            <StepKey label="−" disabled={days! <= 1} onPress={() => setDays(days! - 1)} accessibilityLabel="Un jour plus tôt" />
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text style={styles.date}>{dateTimeLabel(end, now)}</Text>
              <Text style={type.dim}>
                {countdownLabel(end, now)} · {days} jour{days! > 1 ? 's' : ''}
              </Text>
            </View>
            <StepKey label="+" disabled={days! >= MAX_LIFETIME_DAYS} onPress={() => setDays(days! + 1)} accessibilityLabel="Un jour plus tard" />
          </View>
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={type.dim}>Le groupe reste jusqu’à ce que le dernier membre le quitte.</Text>
        </View>
      )}

      <Button title="Continuer" onPress={() => onSubmit(days)} />
    </View>
  );
}

function StepKey({ label, disabled, onPress, accessibilityLabel }: { label: string; disabled: boolean; onPress(): void; accessibilityLabel: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [styles.key, pressed && styles.keyPressed, disabled && { opacity: 0.35 }]}
    >
      <Text style={styles.keyLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  form: { flex: 1, backgroundColor: colors.bg, padding: space.lg, gap: space.md },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  option: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 8, borderWidth: 1, borderColor: colors.border },
  optionOn: { backgroundColor: colors.accent, borderColor: colors.accentFg },
  optionText: { color: colors.textDim, fontSize: 14 },
  optionTextOn: { color: colors.text, fontWeight: '600' },
  card: { backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: space.md, gap: space.sm },
  caption: { color: colors.textDim, fontSize: 12, letterSpacing: 2, fontFamily: fonts.medium },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  date: { color: colors.text, fontSize: 17, fontFamily: fonts.semibold },
  key: {
    width: 44,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#24282B',
    borderWidth: 1.5,
    borderTopColor: '#4A5056',
    borderLeftColor: '#4A5056',
    borderBottomColor: '#0A0B0C',
    borderRightColor: '#0A0B0C',
  },
  keyPressed: { backgroundColor: '#1B1E20', borderTopColor: '#0A0B0C', borderLeftColor: '#0A0B0C', borderBottomColor: '#4A5056', borderRightColor: '#4A5056' },
  keyLabel: { color: colors.text, fontSize: 22, fontFamily: fonts.medium },
});
