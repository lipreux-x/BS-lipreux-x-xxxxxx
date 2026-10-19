// iOS home-screen name with its accent. The app's `name` stays ASCII
// ("BaseSecrete") because Xcode builds its target and product names from it
// and fails on special characters; Expo sets the display name from `name`,
// so it is put back here, after Expo's own Info.plist changes.
const { withInfoPlist } = require('expo/config-plugins');

module.exports = function withDisplayName(config, displayName) {
  return withInfoPlist(config, (c) => {
    c.modResults.CFBundleDisplayName = displayName;
    return c;
  });
};
