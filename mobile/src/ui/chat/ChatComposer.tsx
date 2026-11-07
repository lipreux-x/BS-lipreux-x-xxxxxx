import { useState } from 'react';
import { type TextInput } from 'react-native';
import type { PreparedVoice } from '@/services/groups';
import { useVoiceRecorder } from '@/services/voice';
import { Composer } from './Composer';
import type { Quote } from './replies';
import { useDialog } from '../Dialog';

/**
 * The composer, with what changes as the user types or records: the draft and
 * the recorder's ticks (10 a second) re-render only this, not the conversation.
 */
export function ChatComposer({
  attaching,
  onAttach,
  replyTo,
  onCancelReply,
  inputRef,
  onSendText,
  onSendVoice,
  placeholder,
}: {
  attaching: boolean;
  onAttach(): void;
  replyTo: Quote | null;
  onCancelReply(): void;
  inputRef: React.Ref<React.ComponentRef<typeof TextInput>>;
  onSendText(text: string): void;
  onSendVoice(voice: PreparedVoice): void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState('');
  const recorder = useVoiceRecorder(onSendVoice);
  const [dialog, dialogView] = useDialog();

  async function startVoice() {
    const res = await recorder.start();
    if (res === 'denied') {
      dialog('Micro désactivé', 'Autorise l’accès au micro dans les réglages du téléphone pour envoyer des vocaux.');
    } else if (res === 'failed') {
      dialog('Impossible d’enregistrer', 'Le micro n’a pas pu démarrer. Réessaie.');
    }
  }

  return (
    <>
      {dialogView}
      <Composer
        value={draft}
        onChange={setDraft}
        attaching={attaching}
        onAttach={onAttach}
        replyTo={replyTo}
        onCancelReply={onCancelReply}
        inputRef={inputRef}
        placeholder={placeholder}
        voice={{
          phase: recorder.phase,
          elapsedMs: recorder.elapsedMs,
          levels: recorder.levels,
          onStart: () => void startVoice(),
          onCancel: () => void recorder.cancel(),
          onSend: () => void recorder.finish(),
        }}
        onSend={() => {
          const text = draft.trim().replace(/^\u0000+/, ''); // a leading NUL marks structured bodies
          setDraft('');
          if (text) onSendText(text);
        }}
      />
    </>
  );
}
