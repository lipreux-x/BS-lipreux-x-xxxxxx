/**
 * Unit tests for pure TS modules (crypto, services). Runs in Node, once per
 * crypto backend: native libsodium (via libsodium-wrappers-sumo) and the
 * pure-JS backend used in Expo Go.
 */
const base = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  transform: {
    '^.+\.tsx?$': ['ts-jest', { tsconfig: { strict: true, esModuleInterop: true, module: 'commonjs', target: 'es2022', types: ['jest', 'node'] } }],
  },
  moduleNameMapper: {
    // The app has no native libsodium: tests plug in the WASM build, same API.
    '^\./nativeSodium$': 'libsodium-wrappers-sumo',
    '^expo-crypto$': '<rootDir>/test-support/expo-crypto.js',
    // No native module under Jest: crypto/kdf.ts falls back to JS (tests only).
    'modules/bs-native$': '<rootDir>/test-support/bs-native.js',
    '^@/(.*)$': '<rootDir>/src/$1',
  },
};

module.exports = {
  projects: [
    { ...base, displayName: 'libsodium', setupFiles: ['<rootDir>/test-support/backend-libsodium.js'] },
    { ...base, displayName: 'js', setupFiles: ['<rootDir>/test-support/backend-js.js'] },
  ],
};
