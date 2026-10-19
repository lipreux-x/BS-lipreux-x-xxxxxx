package expo.modules.bsnative

import android.os.Build
import android.os.SystemClock
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.security.KeyStore
import java.util.Arrays
import javax.crypto.KeyGenerator
import javax.crypto.Mac
import javax.crypto.SecretKey

internal object Argon2 {
  init {
    System.loadLibrary("bsnative")
  }

  @JvmStatic external fun hash(password: ByteArray, salt: ByteArray, ops: Int, memKiB: Int, length: Int): ByteArray?
}

private fun decode(s: String): ByteArray = Base64.decode(s, Base64.NO_WRAP)

private fun encode(b: ByteArray): String = Base64.encodeToString(b, Base64.NO_WRAP)

class BsNativeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("BsNative")

    // Async functions run off the JS thread: 64 MiB of Argon2id takes a fraction of a second.
    AsyncFunction("argon2id") { password: String, salt: String, ops: Int, memBytes: Int, length: Int ->
      val pw = decode(password)
      try {
        val out = Argon2.hash(pw, decode(salt), ops, memBytes / 1024, length)
          ?: throw CodedException("ERR_ARGON2", "argon2id failed", null)
        encode(out).also { Arrays.fill(out, 0) }
      } finally {
        Arrays.fill(pw, 0)
      }
    }

    AsyncFunction("devicePrf") { input: String ->
      encode(DeviceKey.prf(decode(input)))
    }

    AsyncFunction("deleteDeviceKey") {
      DeviceKey.delete()
    }

    // Counts during deep sleep, unaffected by the wall clock.
    Function("uptimeMs") {
      SystemClock.elapsedRealtime().toDouble()
    }
  }
}

/*
 * An HMAC-SHA256 key generated inside the Android Keystore (StrongBox when
 * the phone has one): it can be used, never read, so a copy of the app's
 * storage is useless on another device. Usable only while the phone is
 * unlocked (API 28+).
 */
internal object DeviceKey {
  private const val ALIAS = "bs.device_prf"

  fun prf(input: ByteArray): ByteArray {
    val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    val key = (ks.getKey(ALIAS, null) as? SecretKey) ?: create()
    return Mac.getInstance("HmacSHA256").run {
      init(key)
      doFinal(input)
    }
  }

  fun delete() {
    val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    if (ks.containsAlias(ALIAS)) ks.deleteEntry(ALIAS)
  }

  private fun create(): SecretKey {
    // Strongest first; each fallback only when the phone cannot do better.
    val attempts = listOf(true to true, false to true, false to false)
    var last: Exception? = null
    for ((strongBox, unlockedOnly) in attempts) {
      try {
        val spec = KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_SIGN)
          .setDigests(KeyProperties.DIGEST_SHA256)
          .apply {
            if (Build.VERSION.SDK_INT >= 28) {
              if (strongBox) setIsStrongBoxBacked(true)
              if (unlockedOnly) setUnlockedDeviceRequired(true)
            }
          }
          .build()
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_HMAC_SHA256, "AndroidKeyStore")
        gen.init(spec)
        return gen.generateKey()
      } catch (e: Exception) {
        last = e
      }
    }
    throw CodedException("ERR_DEVICE_KEY", "keystore: ${last?.javaClass?.simpleName}", last)
  }
}
