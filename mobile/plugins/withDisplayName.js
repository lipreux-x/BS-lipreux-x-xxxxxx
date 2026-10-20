// Home-screen name with its accent, on iOS and Android. The app's `name`
// stays ASCII ("BaseSecrete") because Xcode builds its target and product
// names from it and fails on special characters; Expo sets the display name
// (iOS CFBundleDisplayName, Android app_name) from `name`, so it is put back
// here, after Expo's own changes.
const { AndroidConfig, withInfoPlist, withStringsXml } = require('expo/config-plugins');

module.exports = function withDisplayName(config, displayName) {
  config = withInfoPlist(config, (c) => {
    c.modResults.CFBundleDisplayName = displayName;
    return c;
  });
  return withStringsXml(config, (c) => {
    c.modResults = AndroidConfig.Strings.setStringItem(
      [AndroidConfig.Resources.buildResourceItem({ name: 'app_name', value: displayName })],
      c.modResults,
    );
    return c;
  });
};
