/**
 * Every crypto failure surfaces as a CryptoError with a coarse code. The
 * underlying libsodium message is deliberately dropped so nothing about keys
 * or plaintext can leak into logs.
 */
export type CryptoErrorCode =
  | 'DECRYPT_FAILED' // wrong key, wrong code, or tampered ciphertext
  | 'BAD_SIGNATURE'
  | 'INVALID_INPUT';

export class CryptoError extends Error {
  constructor(public readonly code: CryptoErrorCode) {
    super(code);
    this.name = 'CryptoError';
  }
}

export function attempt<T>(code: CryptoErrorCode, fn: () => T): T {
  try {
    return fn();
  } catch {
    throw new CryptoError(code);
  }
}
