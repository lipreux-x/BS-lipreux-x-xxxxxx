// Under Jest (Node) there is no React Native: the services that watch the
// app's foreground state (services/realtime.ts) get an AppState that is
// always active and never changes.
module.exports = {
  AppState: {
    currentState: 'active',
    addEventListener() {
      return { remove() {} };
    },
  },
};
