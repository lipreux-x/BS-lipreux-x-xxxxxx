// Development builds (APP_VARIANT=development, set by the `development` EAS
// profile and by `npm start`) install next to the shareable app: their own
// package / bundle id, name and URL scheme. Everything else is app.json.
//
// The dev variant has no google-services.json (Firebase only knows the main
// package), so push notifications are unavailable in it on Android.
const IS_DEV = process.env.APP_VARIANT === 'development';

module.exports = ({ config }) => {
  if (!IS_DEV) return config;
  const { googleServicesFile, ...android } = config.android;
  return {
    ...config,
    name: 'BaseSecrete Dev',
    scheme: 'basesecrete-dev',
    ios: { ...config.ios, bundleIdentifier: `${config.ios.bundleIdentifier}.dev` },
    android: { ...android, package: `${config.android.package}.dev` },
    plugins: config.plugins.map((p) =>
      Array.isArray(p) && p[0] === './plugins/withDisplayName' ? [p[0], 'BaseSecrète Dev'] : p,
    ),
  };
};
