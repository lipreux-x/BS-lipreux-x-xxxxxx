#include <jni.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include "argon2.h"

/*
 * Argon2id v1.3, one lane, raw output: byte-for-byte what libsodium's
 * crypto_pwhash(ALG_ARGON2ID13) returns for the same inputs. Returns null
 * (and the Kotlin side throws) on any error.
 */
JNIEXPORT __attribute__((visibility("default"))) jbyteArray JNICALL
Java_expo_modules_bsnative_Argon2_hash(JNIEnv *env, jclass cls, jbyteArray password, jbyteArray salt, jint ops,
                                        jint memKiB, jint length) {
  (void)cls;
  if (ops < 1 || memKiB < 8 || length < 16 || length > 1024) return NULL;
  jsize pwLen = (*env)->GetArrayLength(env, password);
  jsize saltLen = (*env)->GetArrayLength(env, salt);
  jbyte *pw = (*env)->GetByteArrayElements(env, password, NULL);
  jbyte *sa = (*env)->GetByteArrayElements(env, salt, NULL);
  uint8_t *out = malloc((size_t)length);
  int rc = ARGON2_MEMORY_ALLOCATION_ERROR;
  if (pw && sa && out) {
    rc = argon2id_hash_raw((uint32_t)ops, (uint32_t)memKiB, 1, pw, (size_t)pwLen, sa, (size_t)saltLen, out, (size_t)length);
  }
  if (pw) {
    memset(pw, 0, (size_t)pwLen);
    (*env)->ReleaseByteArrayElements(env, password, pw, JNI_ABORT);
  }
  if (sa) (*env)->ReleaseByteArrayElements(env, salt, sa, JNI_ABORT);
  jbyteArray result = NULL;
  if (rc == ARGON2_OK) {
    result = (*env)->NewByteArray(env, length);
    if (result) (*env)->SetByteArrayRegion(env, result, 0, length, (const jbyte *)out);
  }
  if (out) {
    memset(out, 0, (size_t)length);
    free(out);
  }
  return result;
}
