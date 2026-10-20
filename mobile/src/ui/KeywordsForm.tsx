import { useRef, useState, type ComponentRef } from 'react';
import { Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { KEYWORD_COUNT, KEYWORD_MAX_LENGTH, keywordsProblem } from '@/services/keywords';
import { Button } from './Button';
import { colors, space, type } from './theme';

/** 3 keyword fields + submit. `onSubmit` returns null on success or an error message to show. */
export function KeywordsForm({
  hint,
  submitTitle,
  initial,
  initialError,
  onSubmit,
}: {
  hint: string;
  submitTitle: string;
  initial?: string[];
  initialError?: string;
  onSubmit(words: string[]): Promise<string | null>;
}) {
  const [words, setWords] = useState<string[]>(initial ?? Array.from({ length: KEYWORD_COUNT }, () => ''));
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [busy, setBusy] = useState(false);
  const inputs = useRef<(ComponentRef<typeof TextInput> | null)[]>([]);
  const problem = keywordsProblem(words);

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
        <TextInput
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
          placeholderTextColor={colors.textDim}
          maxLength={KEYWORD_MAX_LENGTH}
          autoCapitalize="none"
          autoCorrect={false}
          // Android keyboards would still learn the words and suggest them in other apps.
          keyboardType={Platform.OS === 'android' ? 'visible-password' : 'default'}
          autoFocus={i === 0}
          returnKeyType={i < KEYWORD_COUNT - 1 ? 'next' : 'done'}
          submitBehavior={i < KEYWORD_COUNT - 1 ? 'submit' : 'blurAndSubmit'}
          onSubmitEditing={() => (i < KEYWORD_COUNT - 1 ? inputs.current[i + 1]?.focus() : void submit())}
          style={styles.input}
        />
      ))}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button title={submitTitle} disabled={!!problem} busy={busy} onPress={() => void submit()} />
    </View>
  );
}

const styles = StyleSheet.create({
  form: { flex: 1, backgroundColor: colors.bg, padding: space.lg, gap: space.md },
  input: { height: 52, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, color: colors.text, paddingHorizontal: space.md, fontSize: 16 },
  error: { color: colors.danger },
});
