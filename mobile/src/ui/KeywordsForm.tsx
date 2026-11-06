import { useRef, useState, type ComponentRef } from 'react';
import { Platform, StyleSheet, Text, type TextInput, View } from 'react-native';
import { KEYWORD_ACCEPT_LENGTH, KEYWORD_COUNT, KEYWORD_MAX_LENGTH, keywordsProblem } from '@/services/keywords';
import { Button } from './Button';
import { Field } from './Screen';
import { colors, mono, space, type } from './theme';

/**
 * 3 keyword fields + submit. `onSubmit` returns null on success or an error
 * message to show. `choose`: the admin picks them (a new group, a code
 * change), at most KEYWORD_MAX_LENGTH characters each, a counter at the end
 * of each field; otherwise they are typed to join or open a group.
 */
export function KeywordsForm({
  hint,
  submitTitle,
  initial,
  initialError,
  choose,
  onSubmit,
}: {
  hint: string;
  submitTitle: string;
  initial?: string[];
  initialError?: string;
  choose?: boolean;
  onSubmit(words: string[]): Promise<string | null>;
}) {
  const max = choose ? KEYWORD_MAX_LENGTH : KEYWORD_ACCEPT_LENGTH;
  const [words, setWords] = useState<string[]>(initial ?? Array.from({ length: KEYWORD_COUNT }, () => ''));
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [busy, setBusy] = useState(false);
  const inputs = useRef<(ComponentRef<typeof TextInput> | null)[]>([]);
  const problem = keywordsProblem(words, max);

  async function submit() {
    if (problem) return setError(problem);
    setBusy(true);
    const message = await onSubmit(words.map((w) => w.trim())).catch(() => 'Erreur inattendue');
    setBusy(false);
    setError(message);
  }

  return (
    <View style={styles.form}>
      <Text style={type.dim}>{hint}</Text>
      {words.map((w, i) => (
        <Field
          key={i}
          ref={(r) => {
            inputs.current[i] = r;
          }}
          value={w}
          onChangeText={(t) => {
            setError(null);
            setWords((ws) => ws.map((x, j) => (j === i ? t : x)));
          }}
          placeholder={`Mot-clé ${i + 1}`}
          maxLength={max}
          right={
            choose ? (
              <Text style={[styles.count, w.trim().length > max && styles.over]} accessibilityLabel={`${w.trim().length} caractères sur ${max}`}>
                {w.trim().length}/{max}
              </Text>
            ) : undefined
          }
          autoCapitalize="none"
          autoCorrect={false}
          // Android keyboards would still learn the words and suggest them in other apps.
          keyboardType={Platform.OS === 'android' ? 'visible-password' : 'default'}
          autoFocus={i === 0}
          returnKeyType={i < KEYWORD_COUNT - 1 ? 'next' : 'done'}
          submitBehavior={i < KEYWORD_COUNT - 1 ? 'submit' : 'blurAndSubmit'}
          onSubmitEditing={() => (i < KEYWORD_COUNT - 1 ? inputs.current[i + 1]?.focus() : void submit())}
        />
      ))}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button title={submitTitle} disabled={!!problem} busy={busy} onPress={() => void submit()} />
    </View>
  );
}

const styles = StyleSheet.create({
  form: { flex: 1, backgroundColor: colors.bg, padding: space.lg, gap: space.md },
  error: { color: colors.danger },
  count: { fontFamily: mono, fontSize: 12, color: colors.textDim, paddingRight: 5 },
  over: { color: colors.danger },
});
