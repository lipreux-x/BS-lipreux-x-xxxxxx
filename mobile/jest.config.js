/** Unit tests for pure TS modules (crypto, sync logic). Runs in Node. */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  transform: {
    '^.+\.tsx?$': ['ts-jest', { tsconfig: { strict: true, esModuleInterop: true, module: 'commonjs', target: 'es2022', types: ['jest', 'node'] } }],
  },
  // Native JSI libsodium is unavailable in Node: use the WASM build, same API.
  moduleNameMapper: { '^react-native-libsodium$': 'libsodium-wrappers-sumo' },
};
