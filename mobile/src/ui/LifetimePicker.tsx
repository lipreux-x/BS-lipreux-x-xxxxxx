import { Minus, Plus } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from './Button';
import { countdownLabel, dateTimeLabel } from './chat/timeline';
import { Key } from './Key';
import { Panel } from './Panel';
import { Segment } from './Segment';
import { colors, fonts, space, type } from './theme';

export const MAX_LIFETIME_DAYS = 365;

const PRESETS: { label: string; value: number | null }[] = [
  { label: 'Permanent', value: null },
  { label: '24 h', value: 1 },
  { label: '3 jours', value: 3 },
  { label: '1 semaine', value: 7 },
  { label: '1 mois', value: 30 },
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
      <Segment wrap options={PRESETS} value={days} onChange={setDays} />

      {end ? (
        <Panel title="Autodestruction">
          <View style={styles.stepper}>
            <Key square accessibilityLabel="Un jour plus tôt" disabled={days! <= 1} hitSlop={6} onPress={() => setDays(days! - 1)}>
              <Minus size={20} color={colors.text} />
            </Key>
            <View style={{ flex: 1, alignItems: 'center' }}>
              <Text style={styles.date}>{dateTimeLabel(end, now)}</Text>
              <Text style={type.dim}>
                {countdownLabel(end, now)} · {days} jour{days! > 1 ? 's' : ''}
              </Text>
            </View>
            <Key square accessibilityLabel="Un jour plus tard" disabled={days! >= MAX_LIFETIME_DAYS} hitSlop={6} onPress={() => setDays(days! + 1)}>
              <Plus size={20} color={colors.text} />
            </Key>
          </View>
        </Panel>
      ) : (
        <Panel>
          <Text style={type.dim}>Le groupe reste jusqu’à ce que le dernier membre le quitte.</Text>
        </Panel>
      )}

      <Button title="Continuer" onPress={() => onSubmit(days)} />
    </View>
  );
}

const styles = StyleSheet.create({
  form: { flex: 1, backgroundColor: colors.bg, padding: space.lg, gap: space.md },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  date: { color: colors.text, fontSize: 17, fontFamily: fonts.semibold },
});
