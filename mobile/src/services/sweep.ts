import { Directory, File, Paths } from 'expo-file-system';

/*
 * Plaintext media that may have reached the disk: decrypted voice messages
 * being played, recordings, the photo picker's copies, the image
 * manipulator's outputs, images on their way to the gallery, the document
 * picker's copies and documents handed to another app. Each flow
 * deletes its own files; this sweep catches what a crash or a killed app
 * left behind. Run at every launch, before anything is unlocked.
 */

const DIRS = ['voice', 'Audio', 'ExpoAudio', 'ImagePicker', 'ImageManipulator', 'DocumentPicker', 'files'];
const LOOSE = /\.(jpe?g|png|heic|m4a|mp4|aac|caf|wav)$/i;

export function sweepPlaintextCache(): void {
  try {
    for (const name of DIRS) {
      const dir = new Directory(Paths.cache, name);
      if (dir.exists) dir.delete();
    }
    for (const entry of new Directory(Paths.cache).list()) {
      if (entry instanceof File && LOOSE.test(entry.name)) entry.delete();
    }
  } catch {
    // Best effort: a file in use is swept at the next launch.
  }
}
