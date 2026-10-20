import {
  AudioQuality,
  createAudioPlayer,
  IOSOutputFormat,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  type AudioPlayer,
  type RecordingOptions,
} from 'expo-audio';
import { randomUUID } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { MAX_VOICE_MS } from '@/crypto';
import { wipe } from '@/crypto/encoding';
import { whileSystemUi } from '@/session/autoLock';
import { level, squeeze, WAVEFORM_BARS } from '@/ui/chat/waveform';
import { ApiError } from './api';
import type { PreparedVoice } from './groups';

/*
 * Native side of voice messages: recording and playback.
 *
 * - The recorder writes to a file in the app's cache (no way around it): the
 *   bytes are read into memory as soon as it stops and the file is deleted.
 * - The players of iOS and Android only read files: to listen, the decrypted
 *   audio goes to one temporary file in the cache, deleted when another
 *   message plays and when the app locks. Everything the recorder or the
 *   player could have left behind is swept on lock as well.
 * - Decrypted audio otherwise lives in memory, cleared on lock.
 * - Leaving the app throws away a recording in progress and pauses playback.
 *   The screen stays on while recording and while a message plays, so that
 *   the phone locking itself does not end them.
 * - Recording and listening pause the other apps' audio (music...), which
 *   resumes after; on iOS it would otherwise go on, and into the recording.
 * - No message plays while recording: switching the audio back to playback
 *   would stop the recorder on iOS, and the message would be recorded on
 *   Android.
 * - As on the usual messaging apps, the waveform can be tapped or dragged to
 *   move in a message, and a message that ends hands over to the next one.
 */

const RECORDING: RecordingOptions = {
  extension: '.m4a',
  sampleRate: 22050,
  numberOfChannels: 1,
  bitRate: 32000, // speech: ~240 KB a minute
  isMeteringEnabled: true,
  android: { outputFormat: 'mpeg4', audioEncoder: 'aac' },
  ios: { outputFormat: IOSOutputFormat.MPEG4AAC, audioQuality: AudioQuality.MEDIUM },
  web: { mimeType: 'audio/mp4', bitsPerSecond: 32000 },
};

/** Shorter than this is a slip of the finger, not a message. */
const MIN_VOICE_MS = 700;
const TICK_MS = 100;

const PLAYBACK_DIR = () => new Directory(Paths.cache, 'voice');
// Where expo-audio records by default (Android, iOS).
const RECORDER_DIRS = () => [new Directory(Paths.cache, 'Audio'), new Directory(Paths.cache, 'ExpoAudio')];

// Not mixed with the other apps' audio: it pauses, and resumes once we are done.
const RECORD_MODE = { allowsRecording: true, playsInSilentMode: true, interruptionMode: 'doNotMix' } as const;
const PLAY_MODE = { allowsRecording: false, playsInSilentMode: true, interruptionMode: 'doNotMix' } as const;

// Keep-awake tags: each one lets the screen sleep again on its own.
const RECORDING_AWAKE = 'voice-recording';
const PLAYBACK_AWAKE = 'voice-playback';

const keepAwake = (tag: string, on: boolean) => void (on ? activateKeepAwakeAsync(tag) : deactivateKeepAwake(tag)).catch(() => {});

// ---- Microphone in use, across the app --------------------------------------------

const micListeners = new Set<() => void>();
// The recorder holding the microphone, from its start until its audio mode is reset.
let micHolder: object | null = null;

function holdMic(holder: object, held: boolean) {
  const next = held ? holder : micHolder === holder ? null : micHolder;
  if (next === micHolder) return;
  micHolder = next;
  for (const l of micListeners) l();
}

const subscribeMic = (listener: () => void) => {
  micListeners.add(listener);
  return () => void micListeners.delete(listener);
};

/** A voice message is being recorded: the player stays still. */
export const isRecordingVoice = () => micHolder !== null;

/** `isRecordingVoice`, for the play keys (shown disabled). */
export function useRecordingVoice() {
  return useSyncExternalStore(subscribeMic, isRecordingVoice);
}

export type RecorderPhase = 'idle' | 'starting' | 'recording';

/**
 * Records a voice message. `onRecorded` gets the audio once `finish()` is
 * called (or the length limit is reached); `cancel()` throws it away. Leaving
 * the screen mid-recording also throws it away.
 */
export function useVoiceRecorder(onRecorded: (voice: PreparedVoice) => void) {
  const recorder = useAudioRecorder(RECORDING);
  const [phase, setPhase] = useState<RecorderPhase>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [levels, setLevels] = useState<number[]>([]);
  const samples = useRef<number[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const startedAt = useRef(0);
  const recording = useRef(false);
  // This recorder, as the holder of the microphone (`isRecordingVoice`).
  const [holder] = useState(() => ({}));
  const onRecordedRef = useRef(onRecorded);
  useEffect(() => {
    onRecordedRef.current = onRecorded;
  }, [onRecorded]);

  /** Stops the recorder; the file it wrote and how long it lasted, if it was recording. */
  const stop = useCallback(async (): Promise<{ uri: string | null; durationMs: number } | null> => {
    clearInterval(timer.current);
    keepAwake(RECORDING_AWAKE, false);
    if (!recording.current) {
      holdMic(holder, false); // failed to start
      return null;
    }
    recording.current = false;
    let durationMs = Date.now() - startedAt.current;
    try {
      durationMs = recorder.getStatus().durationMillis || durationMs;
      await recorder.stop();
    } catch {
      // already stopped
    }
    await setAudioModeAsync(PLAY_MODE).catch(() => {});
    holdMic(holder, false);
    return { uri: recorder.uri, durationMs };
  }, [recorder, holder]);

  const finish = useCallback(async () => {
    const done = await stop();
    setPhase('idle');
    if (!done?.uri) return;
    let audio: Uint8Array;
    try {
      audio = await new File(done.uri).bytes();
    } catch {
      return;
    } finally {
      deleteQuietly(done.uri);
    }
    if (done.durationMs < MIN_VOICE_MS || audio.length === 0) return;
    onRecordedRef.current({ audio, durationMs: Math.min(done.durationMs, MAX_VOICE_MS), waveform: squeeze(samples.current) });
  }, [stop]);

  const cancel = useCallback(async () => {
    const done = await stop();
    setPhase('idle');
    if (done?.uri) deleteQuietly(done.uri);
  }, [stop]);

  /** 'denied': no microphone permission. */
  const start = useCallback(async (): Promise<'started' | 'denied' | 'failed'> => {
    if (recording.current) return 'started';
    setPhase('starting');
    try {
      const { granted } = await whileSystemUi(() => requestRecordingPermissionsAsync());
      if (!granted) {
        setPhase('idle');
        return 'denied';
      }
      // From here the player stays still: its audio mode would stop the recorder.
      holdMic(holder, true);
      voicePlayer.stop();
      await setAudioModeAsync(RECORD_MODE);
      await recorder.prepareToRecordAsync();
      recorder.record();
      recording.current = true;
      keepAwake(RECORDING_AWAKE, true);
      startedAt.current = Date.now();
      samples.current = [];
      setElapsedMs(0);
      setLevels([]);
      setPhase('recording');
      timer.current = setInterval(() => {
        const status = recorder.getStatus();
        const ms = status.durationMillis || Date.now() - startedAt.current;
        samples.current.push(level(status.metering ?? -160));
        setElapsedMs(ms);
        setLevels(samples.current.slice(-WAVEFORM_BARS));
        if (ms >= MAX_VOICE_MS) void finish();
      }, TICK_MS);
      return 'started';
    } catch {
      await cancel();
      return 'failed';
    }
  }, [recorder, holder, finish, cancel]);

  // Leaving the chat or the app mid-recording: nothing is sent.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active' && recording.current) void cancel();
    });
    return () => {
      sub.remove();
      void stop().then((done) => done?.uri && deleteQuietly(done.uri));
    };
  }, [stop, cancel]);

  return { phase, elapsedMs, levels, start, finish, cancel };
}

// ---- Playback --------------------------------------------------------------------

/** A voice message the player can load: its id and how to get its decrypted audio. */
export interface VoiceTrack {
  /** Attachment id (or client id while sending). */
  id: string;
  durationMs: number;
  load(): Promise<Uint8Array>;
}

export interface PlaybackState {
  /** The message loaded in the player, if any. */
  id: string | null;
  playing: boolean;
  positionMs: number;
  /** Being downloaded and decrypted before it plays. */
  loadingId: string | null;
  /** Could not be loaded; `gone`: expired or erased on the server. */
  failed: { id: string; gone: boolean } | null;
  /** Listening speed, kept from one message to the next for the session. */
  rate: PlaybackRate;
}

export const PLAYBACK_RATES = [1, 1.5, 2] as const;
export type PlaybackRate = (typeof PLAYBACK_RATES)[number];

const IDLE: PlaybackState = { id: null, playing: false, positionMs: 0, loadingId: null, failed: null, rate: 1 };

/**
 * One voice message plays at a time, across the whole app. When one ends,
 * the next one of the conversation follows (`setQueue`), until the user
 * pauses, plays something else or leaves the conversation.
 */
class VoicePlayer {
  private player: AudioPlayer | null = null;
  private file: File | null = null;
  private state: PlaybackState = IDLE;
  private readonly listeners = new Set<() => void>();
  private next: ((id: string) => VoiceTrack | null) | null = null;
  // Bumped on each request: a slow download does not start over a newer choice.
  private request = 0;

  constructor() {
    AppState.addEventListener('change', (state) => {
      if (state !== 'active' && this.player?.playing) this.player.pause();
    });
  }

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  readonly getState = () => this.state;

  private set(next: Partial<PlaybackState>) {
    const wasPlaying = this.state.playing;
    this.state = { ...this.state, ...next };
    // The screen stays on exactly while a message plays (paused, ended, stopped: it can sleep).
    if (this.state.playing !== wasPlaying) keepAwake(PLAYBACK_AWAKE, this.state.playing);
    for (const l of this.listeners) l();
  }

  /** What follows a message that ended (null: stop there). Cleared with `setQueue(null)`. */
  setQueue(next: ((id: string) => VoiceTrack | null) | null) {
    this.next = next;
  }

  /** Plays `track`, or pauses it if it is the one playing. Nothing while recording. */
  toggle(track: VoiceTrack) {
    if (isRecordingVoice()) return;
    if (this.state.id === track.id && this.player?.playing) this.player.pause();
    else void this.play(track);
  }

  /** Next speed: 1× → 1,5× → 2× → 1×. */
  cycleRate() {
    const rate = PLAYBACK_RATES[(PLAYBACK_RATES.indexOf(this.state.rate) + 1) % PLAYBACK_RATES.length]!;
    this.player?.setPlaybackRate(rate, 'high');
    this.set({ rate });
  }

  /** Moves to `fraction` (0–1) of `track`, starting it there if it is not the one loaded. Nothing while recording. */
  seek(track: VoiceTrack, fraction: number) {
    if (isRecordingVoice()) return;
    const ms = Math.round(Math.min(1, Math.max(0, fraction)) * track.durationMs);
    if (this.state.id === track.id && this.player) {
      void this.player.seekTo(ms / 1000);
      this.set({ positionMs: ms });
      if (!this.player.playing) this.player.play();
    } else {
      void this.play(track, ms);
    }
  }

  private async play(track: VoiceTrack, fromMs = 0) {
    if (isRecordingVoice()) return;
    const request = ++this.request;
    if (this.state.id === track.id && this.player) {
      this.player.play();
      return;
    }
    this.player?.pause(); // another message: the current one stops right away
    let audio = voiceCache.get(track.id);
    if (!audio) {
      this.set({ loadingId: track.id, failed: null });
      try {
        audio = await track.load();
        voiceCache.set(track.id, audio);
      } catch (e) {
        if (request === this.request) this.set({ loadingId: null, failed: { id: track.id, gone: e instanceof ApiError && e.status === 404 } });
        return;
      }
      if (request !== this.request) return;
    }
    this.release();
    await setAudioModeAsync(PLAY_MODE).catch(() => {});
    if (request !== this.request) return;
    const dir = PLAYBACK_DIR();
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    const file = new File(dir, `${randomUUID()}.m4a`);
    file.create();
    file.writeSync(audio);
    this.file = file;
    const player = createAudioPlayer({ uri: file.uri }, { updateInterval: TICK_MS });
    // Started from the middle (tap or drag on a message not loaded yet): a seek
    // before the file is loaded is ignored, so it waits for it, then plays.
    let startAt: number | null = fromMs > 0 ? fromMs : null;
    const startWhenLoaded = () => {
      if (startAt === null || !player.isLoaded) return;
      const at = startAt;
      startAt = null;
      void player
        .seekTo(at / 1000)
        .catch(() => {})
        .then(() => {
          if (this.player === player) player.play();
        });
    };
    player.addListener('playbackStatusUpdate', (s) => {
      if (this.player !== player) return;
      if (startAt !== null) return startWhenLoaded();
      if (s.didJustFinish) this.ended(track.id);
      else this.set({ playing: s.playing, positionMs: Math.round(s.currentTime * 1000) });
    });
    this.player = player;
    if (this.state.rate !== 1) player.setPlaybackRate(this.state.rate, 'high');
    this.set({ id: track.id, playing: true, positionMs: fromMs, loadingId: null, failed: null });
    if (startAt === null) player.play();
    else startWhenLoaded(); // already loaded: no status update will say so
  }

  /** The end of a message: the next one of the conversation, or back to the start. */
  private ended(id: string) {
    const following = this.next?.(id);
    if (following) {
      void this.play(following);
      return;
    }
    this.player?.pause();
    void this.player?.seekTo(0);
    this.set({ playing: false, positionMs: 0 });
  }

  private release() {
    const { player, file } = this;
    this.player = null;
    this.file = null;
    if (player) {
      try {
        player.pause();
        player.remove();
      } catch {
        // already released
      }
    }
    if (file) deleteQuietly(file.uri);
  }

  /** Stops playback (and any download about to start) and deletes the temporary file. */
  stop() {
    this.request++;
    this.release();
    this.set({ ...IDLE, rate: this.state.rate });
  }
}

export const voicePlayer = new VoicePlayer();

/** Where the player is, for the bubble of message `id`. */
export function usePlayback(id: string): PlaybackState & { loading: boolean } {
  const state = useSyncExternalStore(voicePlayer.subscribe, voicePlayer.getState);
  const mine = state.id === id ? state : IDLE;
  return { ...mine, loading: state.loadingId === id, failed: state.failed?.id === id ? state.failed : null };
}

// ---- Memory and cleanup ------------------------------------------------------------

/** Decrypted voice messages of this session, by attachment id. Cleared on lock. */
const cache = new Map<string, Uint8Array>();
const MAX_CACHED = 20;

export const voiceCache = {
  get: (id: string) => cache.get(id),
  set(id: string, audio: Uint8Array) {
    cache.delete(id);
    cache.set(id, audio);
    for (const old of cache.keys()) {
      if (cache.size <= MAX_CACHED) break;
      cache.delete(old);
    }
  },
  /** On lock: stop playback, wipe the audio in memory, delete every audio file left in the cache. */
  clear() {
    voicePlayer.stop();
    for (const bytes of cache.values()) wipe(bytes);
    cache.clear();
    for (const dir of [PLAYBACK_DIR(), ...RECORDER_DIRS()]) {
      try {
        if (dir.exists) dir.delete();
      } catch {
        // in use or already gone: swept at the next lock
      }
    }
  },
};

function deleteQuietly(uri: string) {
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // already gone
  }
}
