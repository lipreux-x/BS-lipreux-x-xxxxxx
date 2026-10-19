// Android 13+: no screenshot of the app in the recent apps view (a blank card
// instead). Unlike FLAG_SECURE, the user can still take screenshots. Older
// Android versions only get the JS cover (src/ui/PrivacyCover.tsx).
const { withMainActivity } = require('expo/config-plugins');

const LINE = 'if (android.os.Build.VERSION.SDK_INT >= 33) setRecentsScreenshotEnabled(false)';

module.exports = function withHiddenRecents(config) {
  return withMainActivity(config, (c) => {
    const { language, contents } = c.modResults;
    if (language !== 'kt') throw new Error('withHiddenRecents: expected a Kotlin MainActivity');
    if (contents.includes(LINE)) return c;
    const call = /^(\s*)super\.onCreate\([^)]*\)\s*$/m;
    if (!call.test(contents)) throw new Error('withHiddenRecents: super.onCreate not found in MainActivity');
    c.modResults.contents = contents.replace(call, (m, indent) => `${m}\n${indent}${LINE}`);
    return c;
  });
};
