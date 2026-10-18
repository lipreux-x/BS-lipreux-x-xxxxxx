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
    // Native JSI libsodium is unavailable in Node: use the WASM build, same API.
    '^react-native-libsodium$': 'libsodium-wrappers-sumo',
    '^expo-crypto$': '<rootDir>/test-support/expo-crypto.js',
    '^@/(.*)$': '<rootDir>/src/$1',
  },
};

module.exports = {
  projects: [
    { ...base, displayName: 'libsodium', setupFiles: ['<rootDir>/test-support/backend-libsodium.js'] },
    { ...base, displayName: 'js', setupFiles: ['<rootDir>/test-support/backend-js.js'] },
  ],
};
