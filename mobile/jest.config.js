/** Unit tests for pure TS modules (crypto, services). Runs in Node. */
module.exports = {
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
