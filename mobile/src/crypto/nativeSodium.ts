// No native libsodium in the app: react-native-libsodium does not build on
// React Native's New Architecture (it needs the removed RCTCxxBridge), which
// Expo SDK 58 requires. Jest maps this module to libsodium-wrappers-sumo
// (jest.config.js) so the tests still check the JS backend against libsodium.
const native: unknown = null;
export default native;
