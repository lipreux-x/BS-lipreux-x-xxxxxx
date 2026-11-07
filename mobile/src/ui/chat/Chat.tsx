import * as Haptics from 'expo-haptics';
import { router, Stack, useFocusEffect } from 'expo-router';
import { Settings } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Keyboard, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { type FileBody, type ReplyRef } from '@/crypto';
import { useUnlocked, type OpenGroup } from '@/session/SessionProvider';
import { colorIn } from '@/services/groupColors';
import { newClientId, type ChatMessage, type PreparedImage } from '@/services/groups';
import { DocumentsUnavailableError, FileTooLargeError, openDocument, pickDocument } from '@/services/files';
import { pickImage } from '@/services/images';
import { records } from '@/services/localStore';
import { myReaction } from '@/ui/chat/reactions';
import { ActionKey, ActionSheet, MessageActions } from '@/ui/chat/MessageActions';
import { ReactionIcon } from '@/ui/chat/ReactionKeys';
import { chatLook, type ChatLook } from '@/ui/chat/look';
import { replyRefFor, resolveQuote } from '@/ui/chat/replies';
import { countdownLabel, dateTimeLabel, dayLabel } from '@/ui/chat/timeline';
import { ChatComposer } from '@/ui/chat/ChatComposer';
import { DECRYPTING, GroupGone } from '@/ui/chat/GroupUnlock';
import { Timeline, type Item, type Line } from '@/ui/chat/ChatTimeline';
import { useChat } from '@/ui/chat/useChat';
import { useEphemeral } from '@/ui/chat/useEphemeral';
import { useKeep } from '@/ui/chat/useKeep';
import { useMemberColors } from '@/ui/chat/useMemberColors';
import { useModeration } from '@/ui/chat/useModeration';
import { useReactions } from '@/ui/chat/useReactions';
import { useStories } from '@/ui/chat/useStories';
import { useDialog } from '@/ui/Dialog';
import { Key } from '@/ui/Key';
import { labelText } from '@/ui/Label';
import { panelStyle } from '@/ui/Panel';
import { FileBubble, LocalFile } from '@/ui/FileBubble';
import { ImageBubble, LocalImage } from '@/ui/ImageBubble';
import { ImageViewer } from '@/ui/ImageViewer';
import { KeyboardGlide } from '@/ui/KeyboardGlide';
import { PrivacyCover } from '@/ui/PrivacyCover';
import { SentVoice, VoiceBubble } from '@/ui/VoiceBubble';
import { Led } from '@/ui/Led';
import { STORIES_RAIL_H, StoriesBand } from '@/ui/stories/StoriesBand';
import { QuotedStories } from '@/ui/stories/StoryThumb';
import type { StoryMessage } from '@/ui/stories/stories';
import { CaptureScreen, type CaptureKind } from '@/ui/camera/CaptureScreen';
import { Working } from '@/ui/Working';
import { colors, fonts, mono, space, type } from '@/ui/theme';

// ---- Chat (SPEC §2.4) ------------------------------------------------------------------

const ERASE_SPANS: { days: number; label: string }[] = [
  { days: 1, label: 'Ce jour' },
  { days: 2, label: 'Ce jour et la veille' },
  { days: 7, label: 'Les 7 jours jusqu’à ce jour' },
];

export function Chat({
  groupId,
  group,
  onUpdate,
  onLocked,
  onReady,
  titled,
  onStoriesOpen,
}: {
  groupId: string;
  group: OpenGroup;
  onUpdate(g: OpenGroup): void;
  onLocked(): void;
  /** Called once there is something to show: the history decrypted, or the group gone. */
  onReady?(): void;
  /** False while the code entry is still over it: the header stays the locked group's. */
  titled: boolean;
  /** The stories pulled down, or folded back. */
  onStoriesOpen?(open: boolean): void;
}) {
  const { session, profiles, openGroups } = useUnlocked();
  const [dialog, dialogView] = useDialog();
  const keep = useKeep(session);
  const list = useRef<FlatList<Item>>(null);

  // The message core: the history, the live sync and the outbox.
  const {
    messages,
    pending,
    setPending,
    loaded,
    readMark,
    online,
    fetchFailed,
    removed,
    role,
    expiresAt,
    alert,
    newAdmin,
    setNewAdmin,
    rotationWait,
    requests,
    reviewing,
    setReviewing,
    resync,
    decide,
    send,
    retry,
    reset,
    current,
  } = useChat({ session, profiles, groupId, group, onUpdate, onLocked, dialog, keep, list });

  const [picking, setPicking] = useState(false);
  const [viewing, setViewing] = useState<Uint8Array | null>(null);
  // The message being answered (composer strip), and the one long-pressed (action sheet).
  const [replying, setReplying] = useState<ChatMessage | null>(null);
  const [pressed, setPressed] = useState<ChatMessage | null>(null);
  // "Répondre" picked in the action sheet: the keyboard comes up once the sheet is gone.
  const replyAfterSheet = useRef(false);
  const input = useRef<React.ComponentRef<typeof TextInput>>(null);

  /** Answer `m`: reply strip above the composer, keyboard up. */
  const startReply = useCallback((m: ChatMessage) => {
    setReplying(m);
    input.current?.focus();
  }, []);

  /** Long press on a message: its actions, over the keyboard put away. */
  const openActions = useCallback((m: ChatMessage) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Keyboard.dismiss();
    replyAfterSheet.current = false;
    setPressed(m);
  }, []);

  /** Tap on a photo: full screen, without the keyboard over it. */
  const openImage = useCallback((jpeg: Uint8Array) => {
    Keyboard.dismiss();
    setViewing(jpeg);
  }, []);

  // The app's camera, open for a story or a photo of the chat, and the panel of a story that failed.
  const [capture, setCapture] = useState<CaptureKind | null>(null);
  const [storySheet, setStorySheet] = useState(false);

  const { now, destroyed, eraseDay, setEraseDay, confirmErase } = useEphemeral({ expiresAt, resync, reset, session, groupId, openGroups, current, dialog });

  const ready = loaded || removed || destroyed;
  useEffect(() => {
    if (ready) onReady?.();
  }, [ready, onReady]);

  // Reporting, blocking, and each member’s colour in this group.
  const { reporting, setReporting, reportedView, blocked, armReport, armBlock, pickReason, onActionsHidden, onReasonsHidden } = useModeration(session, groupId, keep, dialog);
  const memberColors = useMemberColors(session, groupId, keep, messages);
  const shown = useMemo(() => {
    const ids = Object.keys(blocked);
    const visible = ids.length && messages.some((m) => ids.includes(m.senderId)) ? messages.filter((m) => !ids.includes(m.senderId)) : messages;
    if (!memberColors) return visible;
    return visible.map((m) => {
      const color = colorIn(memberColors, m.senderId, m.senderColor);
      return color === m.senderColor ? m : { ...m, senderColor: color };
    });
  }, [messages, blocked, memberColors]);

  // The chat shows everything but the stories (in the band above it) and the reactions (under their messages).
  const chatMessages = useMemo(() => (shown.some((m) => m.story || m.reaction) ? shown.filter((m) => !m.story && !m.reaction) : shown), [shown]);
  const chatPending = useMemo(
    () => (pending.some((p) => p.kind === 'story' || p.kind === 'reaction') ? pending.filter((p) => p.kind !== 'story' && p.kind !== 'reaction') : pending),
    [pending],
  );
  // How the conversation is drawn, chosen for this group on this phone (group settings): read again on coming back from them.
  const [look, setLook] = useState<ChatLook>('terminal');
  useFocusEffect(
    useCallback(() => {
      void keep(async (l) => setLook(chatLook((await l.getRecord<{ look: unknown }>(records.look(groupId)))?.look)));
    }, [keep, groupId]),
  );
  // The reaction keys' order (this phone), the tally under each message, and the senders.
  const { order, reorder, reactionTally, react, quickReact } = useReactions(shown, pending, session.account.userId, keep, send);
  // The stories: the band's state, and what its keys do.
  const stories = useStories({ groupId, shown, pending, keep, react, reply: setReplying, onOpenChange: onStoriesOpen });
  const storyFailed = stories.failed;
  // The quotes of a story show it small (bubbles and the reply strip).
  const quotedStories = useMemo(
    () => ({ session, groupId, find: (id: string) => stories.messages.find((s) => s.id === id) as StoryMessage | undefined }),
    [session, groupId, stories.messages],
  );

  /** The reply to attach to the next message, and clear it from the composer. */
  function takeReply(): ReplyRef | undefined {
    const ref = replying ? (replyRefFor(replying) ?? undefined) : undefined;
    setReplying(null);
    return ref;
  }

  async function sendPhoto() {
    setPicking(true);
    try {
      const image = await pickImage();
      if (image) void send({ clientId: newClientId(), at: new Date().toISOString(), kind: 'image', image, failed: false, replyTo: takeReply() });
    } catch {
      // Picker or re-encoding failed: nothing was sent.
    } finally {
      setPicking(false);
    }
  }

  /** A document (a PDF…), sent as it is: the system's picker, then the outbox like a photo. */
  async function sendDocument() {
    setPicking(true);
    try {
      const file = await pickDocument();
      if (file) void send({ clientId: newClientId(), at: new Date().toISOString(), kind: 'file', file, failed: false, replyTo: takeReply() });
    } catch (e) {
      if (e instanceof FileTooLargeError) dialog('Fichier trop lourd', 'Un document fait 10 Mo au maximum.');
      else if (e instanceof DocumentsUnavailableError) dialog('Nouveau build nécessaire', 'Cette version de l’app ne sait pas encore envoyer de documents : installe le dernier build.');
      // Picker or read failed otherwise: nothing was sent.
    } finally {
      setPicking(false);
    }
  }

  /** A document tapped in the chat, decrypted: handed to another app (the share sheet). */
  const openFile = useCallback(
    async (bytes: Uint8Array, body: FileBody) => {
      try {
        await openDocument(bytes, body.name, body.mime);
      } catch (e) {
        if (e instanceof DocumentsUnavailableError) {
          dialog('Nouveau build nécessaire', 'Cette version de l’app ne sait pas encore ouvrir de documents : installe le dernier build.');
        } else {
          dialog('Impossible d’ouvrir', 'Aucune app n’a pu recevoir ce document.');
        }
      }
    },
    [dialog],
  );

  // The "+" key of the composer: a photo or a document, chosen in a panel.
  const [attachSheet, setAttachSheet] = useState(false);
  const afterAttachSheet = useRef<(() => void) | null>(null);
  function closeAttachSheet(then?: () => void) {
    afterAttachSheet.current = then ?? null;
    setAttachSheet(false);
  }

  /** What runs once the "story" panel is gone (camera, picker). */
  const afterStorySheet = useRef<(() => void) | null>(null);
  function closeStorySheet(then?: () => void) {
    afterStorySheet.current = then ?? null;
    setStorySheet(false);
  }

  /** The photo taken (or picked) in the app's camera, once checked: a story, or a photo of the chat. */
  function sendShot(image: PreparedImage) {
    const at = new Date().toISOString();
    if (capture === 'story') void send({ clientId: newClientId(), at, kind: 'story', image, failed: false }, { scroll: false });
    else void send({ clientId: newClientId(), at, kind: 'image', image, failed: false, replyTo: takeReply() });
    setCapture(null);
  }

  const renderContent = useCallback(
    (item: Line, onLongPress?: () => void) =>
      item.storyReaction ? (
        <View style={styles.reacted}>
          <ReactionIcon id={item.storyReaction} size={16} />
          <Text style={look === 'plates' ? styles.plateText : styles.text}>{item.mine ? 'Tu as réagi à la story' : 'a réagi à la story'}</Text>
        </View>
      ) : item.image ? (
        <ImageBubble session={session} groupId={groupId} body={item.image} onOpen={openImage} onLongPress={onLongPress} />
      ) : item.voice ? (
        <SentVoice session={session} groupId={groupId} body={item.voice} onLongPress={onLongPress} />
      ) : item.localVoice ? (
        <VoiceBubble
          track={{ id: item.key, durationMs: item.localVoice.durationMs, load: () => Promise.resolve(item.localVoice!.audio) }}
          waveform={item.localVoice.waveform}
        />
      ) : item.local ? (
        <LocalImage jpeg={item.local.jpeg} width={item.local.width} height={item.local.height} />
      ) : item.file ? (
        <FileBubble session={session} groupId={groupId} body={item.file} onOpen={openFile} onLongPress={onLongPress} />
      ) : item.localFile ? (
        <LocalFile file={item.localFile} />
      ) : item.text === null ? (
        <Text style={look === 'plates' ? styles.plateUnreadable : styles.unreadable}>Message illisible (signature ou clé invalide)</Text>
      ) : (
        <Text style={look === 'plates' ? styles.plateText : styles.text}>{item.text}</Text>
      ),
    [session, groupId, openImage, openFile, look],
  );

  const eraseMenu = useMemo(
    () =>
      role === 'admin'
        ? (day: Date) => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            Keyboard.dismiss();
            setEraseDay(day);
          }
        : undefined,
    [role],
  );

  // Same object from one render to the next: expo-router sets the header again whenever it changes.
  const headerOptions = useMemo(
    () => ({
      headerTitle: () => (
        <View style={styles.title}>
          <Led state="ok" size={7} />
          <Text style={styles.titleText} numberOfLines={1}>
            {group.name}
          </Text>
        </View>
      ),
      headerRight: () => (
        <Pressable
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={group.direct ? 'Réglages de la discussion' : 'Réglages du groupe'}
          onPress={() => router.push({ pathname: '/group/settings', params: { id: groupId } })}
        >
          <Settings size={22} color={colors.accentFg} />
        </Pressable>
      ),
    }),
    [group.name, group.direct, groupId],
  );

  if (destroyed) return <GroupGone direct={group.direct} />;

  // A private conversation is never left alone: gone from the server means the other one deleted it.
  if (removed && group.direct) return <GroupGone direct />;
  if (removed) {
    return (
      <View style={[styles.center, { padding: space.lg, gap: space.md }]}>
        <Stack.Screen options={{ title: group.name }} />
        <Text style={type.heading}>Tu ne fais plus partie de ce groupe</Text>
        <Text style={[type.dim, { textAlign: 'center' }]}>Un admin t’a retiré. Les nouveaux messages ne te sont plus accessibles.</Text>
      </View>
    );
  }

  return (
    <QuotedStories.Provider value={quotedStories}>
      <SafeAreaView style={styles.screen} edges={['bottom']}>
        {titled ? <Stack.Screen options={headerOptions} /> : null}
        {dialogView}
        {!online ? (
          <View style={styles.banner}>
            <Led state="busy" size={7} />
            <Text style={styles.bannerText}>HORS LIGNE — ENVOI AU RETOUR DU RÉSEAU</Text>
          </View>
        ) : null}
        {online && fetchFailed ? (
          <Pressable style={[styles.banner, styles.alertBanner]} onPress={() => void resync()} accessibilityRole="button">
            <Led state="error" size={7} />
            <Text style={styles.bannerText}>MESSAGES NON CHARGÉS — APPUIE POUR RÉESSAYER</Text>
          </Pressable>
        ) : null}
        {expiresAt ? (
          <View style={styles.banner}>
            <Led state="error" size={7} />
            <Text style={styles.bannerText} numberOfLines={1}>
              AUTODESTRUCTION {countdownLabel(expiresAt, now).toUpperCase()} — {dateTimeLabel(expiresAt, now).toUpperCase()}
            </Text>
          </View>
        ) : null}
        {alert ? (
          <View style={[styles.banner, styles.alertBanner]}>
            <Led state="error" size={7} />
            <Text style={styles.bannerText}>{alert.toUpperCase()}</Text>
          </View>
        ) : null}
        {rotationWait ? (
          <View style={styles.banner}>
            <Led state="busy" size={7} />
            <Text style={styles.bannerText}>UN MEMBRE EST PARTI — ENVOI DÈS QU’UN ADMIN CHANGE LA CLÉ</Text>
          </View>
        ) : null}
        {newAdmin ? (
          <Pressable style={styles.banner} onPress={() => setNewAdmin(false)} accessibilityRole="button">
            <Led state="busy" size={7} />
            <Text style={styles.bannerText}>LES ADMINS DU GROUPE ONT CHANGÉ — VOIR LES RÉGLAGES</Text>
          </Pressable>
        ) : null}
        {requests.length ? (
          <Pressable style={styles.banner} onPress={() => setReviewing(true)} accessibilityRole="button">
            <Led state="busy" size={7} />
            <Text style={styles.bannerText}>
              {requests.length === 1 ? '1 DEMANDE D’ACCÈS — APPUIE POUR VOIR' : `${requests.length} DEMANDES D’ACCÈS — APPUIE POUR VOIR`}
            </Text>
          </Pressable>
        ) : null}
        <Modal visible={reviewing && requests.length > 0} transparent animationType="fade" onRequestClose={() => setReviewing(false)}>
          <View style={styles.sheetBackdrop}>
            <View style={styles.sheet}>
              <Text style={type.heading}>Demandes d’accès</Text>
              <Text style={type.dim}>
                {group.link
                  ? 'Ces personnes ont ouvert un lien d’invitation du groupe. Une demande refusée ne revient pas : il faudra un nouveau lien. '
                  : 'Ces personnes ont donné le bon code et les bons mots-clés. '}
                Accepter leur envoie la clé du groupe. Pour être sûr que c’est bien elles, compare en vrai ce numéro de sécurité avec celui affiché sur
                leur téléphone (Réglages) : les chiffres doivent être identiques.
              </Text>
              {requests.map((r) => (
                <View key={r.userId} style={styles.request}>
                  <Text style={styles.requestName}>{r.username}</Text>
                  {r.keyChanged ? (
                    <Text style={styles.requestWarning}>Ses clés ont changé depuis la dernière fois : ne l’accepte pas sans vérifier.</Text>
                  ) : (
                    <Text style={styles.safety} selectable>
                      {r.fingerprint}
                    </Text>
                  )}
                  <View style={styles.requestButtons}>
                    <Key grow label="Refuser" tone="cold" onPress={() => void decide(r, false)} />
                    {!r.keyChanged ? <Key grow variant="hot" label="Accepter" onPress={() => void decide(r, true)} /> : null}
                  </View>
                </View>
              ))}
              <Pressable onPress={() => setReviewing(false)} accessibilityRole="button" style={styles.sheetClose}>
                <Text style={type.dim}>Fermer</Text>
              </Pressable>
            </View>
          </View>
          {/* A modal is drawn above the app's own cover: it needs its own for the app switcher. */}
          <PrivacyCover />
        </Modal>
        {/* With edge-to-edge (always on since SDK 54), Android no longer shrinks the window
            for the keyboard by itself: the composer is lifted here, in a glide. */}
        <KeyboardGlide style={{ flex: 1 }}>
          {/* The messages start under the stories' rail; the band itself lies over them (rendered last: on top)
              and comes down to the composer, never over it. */}
          <View style={{ flex: 1 }}>
            <View style={{ height: STORIES_RAIL_H }} />
            <Timeline
              look={look}
              direct={!!group.direct}
              listRef={list}
              loaded={loaded}
              messages={chatMessages}
              pending={chatPending}
              renderContent={renderContent}
              onRetry={retry}
              onLongPress={openActions}
              onReply={startReply}
              onDayLongPress={eraseMenu}
              reactions={reactionTally}
              onReact={react}
              onDoubleTap={quickReact}
              colors={memberColors}
              stories={stories.messages}
              storyReactions={stories.reactions}
              onStoryQuote={stories.show}
              readMark={readMark}
            />
            <StoriesBand
              session={session}
              groupId={groupId}
              {...stories.band}
              onAdd={() => {
                Keyboard.dismiss();
                // Straight to the camera; a story that failed is dealt with first.
                if (storyFailed) setStorySheet(true);
                else setCapture('story');
              }}
              onView={openImage}
              reactions={reactionTally}
              order={order}
            />
            {/* Until the history is decrypted (from the phone, or fetched): what the wait is, not a black screen. */}
            {!loaded ? <Working label={DECRYPTING} style={styles.decrypting} /> : null}
          </View>
          <ChatComposer
            placeholder={stories.band.open || replying?.story ? 'Répondre à la story' : undefined}
            attaching={picking}
            onAttach={() => {
              Keyboard.dismiss();
              setAttachSheet(true);
            }}
            replyTo={replying ? resolveQuote(replyRefFor(replying)!, messages, session.account.userId) : null}
            onCancelReply={() => setReplying(null)}
            inputRef={input}
            onSendText={(text) =>
              void send({ clientId: newClientId(), at: new Date().toISOString(), kind: 'text', text, failed: false, replyTo: takeReply() })
            }
            onSendVoice={(voice) =>
              void send({ clientId: newClientId(), at: new Date().toISOString(), kind: 'voice', voice, failed: false, replyTo: takeReply() })
            }
          />
        </KeyboardGlide>
        <ImageViewer jpeg={viewing} onClose={() => setViewing(null)} />
        <CaptureScreen kind={capture} onSend={sendShot} onClose={() => setCapture(null)} />
        {/* The pickers open once the panel is gone (iOS refuses to present over a modal on its way out). */}
        <ActionSheet
          visible={attachSheet}
          onClose={() => closeAttachSheet()}
          onHidden={() => {
            const next = afterAttachSheet.current;
            afterAttachSheet.current = null;
            next?.();
          }}
        >
          <Text style={styles.sheetTitle}>ENVOYER · CHIFFRÉ</Text>
          <ActionKey label="Prendre une photo" onPress={() => closeAttachSheet(() => setCapture('photo'))} />
          <ActionKey label="Une photo de la galerie" onPress={() => closeAttachSheet(() => void sendPhoto())} />
          <ActionKey label="Un document (PDF, …)" onPress={() => closeAttachSheet(() => void sendDocument())} />
          <ActionKey label="Annuler" dim onPress={() => closeAttachSheet()} />
        </ActionSheet>
        {/* A story that failed: what to do with it, or a new one. The camera opens once the panel
            is gone (iOS refuses to present over a modal on its way out). */}
        <ActionSheet
          visible={storySheet}
          onClose={() => closeStorySheet()}
          onHidden={() => {
            const next = afterStorySheet.current;
            afterStorySheet.current = null;
            next?.();
          }}
        >
          <Text style={styles.sheetTitle}>STORY · VISIBLE 24 H PAR LE GROUPE</Text>
          {storyFailed ? (
            <>
              <ActionKey
                label={storyFailed.error ?? 'Réessayer l’envoi'}
                danger={!!storyFailed.error}
                onPress={() => closeStorySheet(storyFailed.error ? undefined : () => retry(storyFailed))}
              />
              <ActionKey
                label="Abandonner cette story"
                dim
                onPress={() => closeStorySheet(() => setPending((p) => p.filter((x) => x.clientId !== storyFailed.clientId)))}
              />
            </>
          ) : null}
          <ActionKey label="Nouvelle story" onPress={() => closeStorySheet(() => setCapture('story'))} />
          <ActionKey label="Annuler" dim onPress={() => closeStorySheet()} />
        </ActionSheet>
        <MessageActions
          target={pressed ? { quote: resolveQuote(replyRefFor(pressed)!, messages, session.account.userId), text: pressed.text } : null}
          reaction={pressed ? myReaction(reactionTally.get(pressed.id)) : null}
          order={order}
          onReorder={reorder}
          onReact={(id) => {
            if (pressed) react(pressed, id);
          }}
          onReply={() => {
            if (!pressed) return;
            // Strip shown now; the keyboard once the sheet is gone (focused under it, it would not come up).
            setReplying(pressed);
            replyAfterSheet.current = true;
          }}
          onReport={pressed && pressed.senderId !== session.account.userId ? () => armReport(pressed) : undefined}
          onBlock={pressed && pressed.senderId !== session.account.userId ? () => armBlock(pressed) : undefined}
          onClose={() => setPressed(null)}
          onHidden={() => {
            // One sheet at a time: the reasons or the block confirmation come up once this one is gone.
            onActionsHidden();
            if (!replyAfterSheet.current) return;
            replyAfterSheet.current = false;
            input.current?.focus();
          }}
        />
        <ActionSheet
          visible={reporting !== null}
          onClose={() => setReporting(null)}
          onHidden={onReasonsHidden}
        >
          <Text style={styles.sheetTitle}>SIGNALER · {(reporting ?? reportedView)?.senderName ?? ''}</Text>
          <Text style={styles.sheetNote}>
            {(reporting ?? reportedView)?.text
              ? 'Le texte de ce message, déchiffré sur ton téléphone, est envoyé à l’équipe de BaseSecrète avec ton signalement. Rien d’autre du groupe.'
              : 'Le serveur ne peut pas voir ce contenu : seuls le nom du membre et ton motif sont envoyés à l’équipe de BaseSecrète.'}
          </Text>
          <ActionKey label="Harcèlement ou insulte" onPress={() => pickReason('abuse')} />
          <ActionKey label="Spam" onPress={() => pickReason('spam')} />
          <ActionKey label="Contenu illégal" onPress={() => pickReason('illegal')} />
          <ActionKey label="Autre" onPress={() => pickReason('other')} />
          <ActionKey label="Annuler" dim onPress={() => setReporting(null)} />
        </ActionSheet>
        <ActionSheet visible={eraseDay !== null} onClose={() => setEraseDay(null)}>
          <Text style={styles.sheetTitle}>EFFACER POUR TOUS · {eraseDay ? dayLabel(eraseDay, now) : ''}</Text>
          {ERASE_SPANS.map((span) => (
            <ActionKey
              key={span.days}
              label={span.label}
              danger
              onPress={() => {
                const day = eraseDay!;
                setEraseDay(null);
                confirmErase(day, span.days);
              }}
            />
          ))}
          <ActionKey label="Annuler" dim onPress={() => setEraseDay(null)} />
        </ActionSheet>
      </SafeAreaView>
    </QuotedStories.Provider>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  decrypting: { backgroundColor: colors.bg },
  title: { flexDirection: 'row', alignItems: 'center', gap: 8, maxWidth: 220 },
  titleText: { color: colors.text, fontSize: 17, fontFamily: fonts.semibold },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 6,
    backgroundColor: colors.surface2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  bannerText: { fontFamily: mono, fontSize: 10, letterSpacing: 1, color: colors.textDim },
  alertBanner: { borderBottomColor: colors.danger },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: space.lg },
  sheet: { ...panelStyle, padding: space.lg, gap: space.md },
  sheetClose: { alignSelf: 'center', padding: space.sm },
  request: { gap: space.sm, paddingTop: space.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  requestName: { ...type.heading, fontSize: 17 },
  requestWarning: { color: colors.danger },
  safety: { fontFamily: mono, fontSize: 15, letterSpacing: 1, color: colors.text, lineHeight: 22 },
  requestButtons: { flexDirection: 'row', gap: space.sm },
  // Entries of the terminal: the monospace font.
  text: { color: colors.text, fontFamily: mono, fontSize: 15, lineHeight: 22 },
  unreadable: { color: colors.textDim, fontFamily: mono, fontStyle: 'italic', fontSize: 14 },
  // On the plates (look chosen per group): the text font.
  plateText: { color: colors.text, fontSize: 16, lineHeight: 21 },
  // A reaction to a story, under its quote: the key's icon, then the words.
  reacted: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  plateUnreadable: { color: colors.textDim, fontStyle: 'italic', fontSize: 14 },
  sheetTitle: { ...labelText, textAlign: 'center', marginBottom: space.xs },
  sheetNote: { ...type.dim, fontSize: 13, textAlign: 'center', marginBottom: space.xs },
});

