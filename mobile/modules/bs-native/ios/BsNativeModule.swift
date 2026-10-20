// Implementation only: the app target that imports BsNative never has to
// resolve Argon2Swift and its C module `argon2` (Xcode explicit modules).
@_implementationOnly import Argon2Swift
import CryptoKit
import ExpoModulesCore
import Foundation
import Security

public class BsNativeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("BsNative")

    // Off the JS thread: 64 MiB of Argon2id takes a fraction of a second.
    AsyncFunction("argon2id") { (password: String, salt: String, ops: Int, memBytes: Int, length: Int) throws -> String in
      guard let pw = Data(base64Encoded: password), let saltData = Data(base64Encoded: salt) else {
        throw Exception(name: "ERR_INPUT", description: "invalid base64")
      }
      let result = try Argon2Swift.hashPasswordBytes(
        password: pw,
        salt: Salt(bytes: saltData),
        iterations: ops,
        memory: memBytes / 1024, // KiB
        parallelism: 1,
        length: length,
        type: .id,
        version: .V13
      )
      return result.hashData().base64EncodedString()
    }

    AsyncFunction("devicePrf") { (input: String) throws -> String in
      guard let data = Data(base64Encoded: input) else {
        throw Exception(name: "ERR_INPUT", description: "invalid base64")
      }
      return try DeviceKey.prf(data).base64EncodedString()
    }

    AsyncFunction("deleteDeviceKey") {
      DeviceKey.delete()
    }

    Function("uptimeMs") { () -> Double in
      // CLOCK_MONOTONIC keeps counting during sleep on Darwin; the wall clock is not used.
      Double(clock_gettime_nsec_np(CLOCK_MONOTONIC)) / 1_000_000
    }
  }
}

/*
 * A P-256 key in the Secure Enclave: its private half cannot be exported, so
 * a forensic copy of the Keychain holds only an opaque blob this phone alone
 * can use. The PRF is HMAC-SHA256 keyed by ECDH(key, its own public key).
 * Devices or simulators without a Secure Enclave get a software key (then
 * protected by the Keychain only, like the rest of the vault).
 */
enum DeviceKey {
  private static let account = "bs.device_prf"
  private static let service = "com.lipreux.basesecrete.devicekey"

  static func prf(_ input: Data) throws -> Data {
    let secret = try sharedSecret()
    let mac = HMAC<SHA256>.authenticationCode(for: input, using: secret)
    return Data(mac)
  }

  static func delete() {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
    ]
    SecItemDelete(query as CFDictionary)
  }

  private static func sharedSecret() throws -> SymmetricKey {
    let stored = try load() ?? create()
    let kind = stored.first
    let blob = stored.dropFirst()
    let shared: SharedSecret
    if kind == 1 {
      let key = try SecureEnclave.P256.KeyAgreement.PrivateKey(dataRepresentation: Data(blob))
      shared = try key.sharedSecretFromKeyAgreement(with: key.publicKey)
    } else {
      let key = try P256.KeyAgreement.PrivateKey(rawRepresentation: Data(blob))
      shared = try key.sharedSecretFromKeyAgreement(with: key.publicKey)
    }
    return shared.withUnsafeBytes { SymmetricKey(data: Data($0)) }
  }

  /** One byte of kind (1: Secure Enclave, 2: software), then the key blob. */
  private static func create() throws -> Data {
    var stored: Data
    if SecureEnclave.isAvailable {
      var error: Unmanaged<CFError>?
      guard let access = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenUnlockedThisDeviceOnly, .privateKeyUsage, &error) else {
        throw Exception(name: "ERR_DEVICE_KEY", description: "access control")
      }
      let key = try SecureEnclave.P256.KeyAgreement.PrivateKey(accessControl: access)
      stored = Data([1]) + key.dataRepresentation
    } else {
      stored = Data([2]) + P256.KeyAgreement.PrivateKey().rawRepresentation
    }
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
      kSecValueData as String: stored,
    ]
    let status = SecItemAdd(query as CFDictionary, nil)
    guard status == errSecSuccess else {
      throw Exception(name: "ERR_DEVICE_KEY", description: "keychain \(status)")
    }
    return stored
  }

  private static func load() throws -> Data? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess, let data = item as? Data, data.count > 1 else {
      throw Exception(name: "ERR_DEVICE_KEY", description: "keychain \(status)")
    }
    return data
  }
}
