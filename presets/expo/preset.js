'use strict';
module.exports = {
  id: 'expo',
  label: 'Expo / React Native',
  description: 'Managed Expo and React Native apps: native tree is protected, store builds and OTA are human-triggered.',
  denyWrite: [{ re: /^android\//, label: 'android/ (managed by prebuild)' }, { re: /^ios\//, label: 'ios/ (managed by prebuild)' }, { re: /(^|\/)google-services\.json$/, label: 'google-services.json' }, { re: /(^|\/)GoogleService-Info\.plist$/, label: 'GoogleService-Info.plist' }],
  denyShell: [
    { re: /^(npx\s+)?eas\s+(build|submit|update)\b/, why: 'store builds and OTA updates are human-triggered only', severity: 'ask' },
    { re: /^(npx\s+)?expo\s+prebuild\b/, why: 'prebuild rewrites the native tree', severity: 'ask' },
    { re: /^pod\s+install\b/, why: 'CocoaPods changes native state', severity: 'ask' },
  ],
  rules: ['react-web/react-components.mdc', 'expo-native.mdc'],
  integrationTriggers: [/^app\.config\.(js|ts)$/, /^app\.json$/, /^eas\.json$/, /^firebase\.json$/, /^plugins\//],
  hardBans: ['Native config only via `app.config.*`, `plugins/`, `eas.json`. `android/` and `ios/` are never edited or committed. Store builds and OTA updates are human-triggered.'],
  safeAuto: ['A small state slice or type change with a written spec', 'Narrow UI fixes inside existing offline / guest flows when the task gives an @path and acceptance criteria'],
  safeHuman: [
    'New native SDK, config plugin, or any change to app.config.*, plugins/, eas.json',
    'Push notifications, OAuth, payments, deep linking, in-app purchases',
    'New offline / socket / auth-guard architecture (small UI inside existing flows is fine with a spec)',
    'Store builds (eas build / submit) and OTA updates',
  ],
  triage: { human: ['native', 'sdk', 'plugin', 'eas', 'ota', 'prebuild', 'permission', 'deep link', 'universal link', 'push', 'oauth', 'нативн', 'плагин', 'пуш', 'диплинк'] },
  doctor: { denyPaths: ['android/app/build.gradle', 'ios/App/Info.plist'], allowPaths: ['app.config.js', 'src/pages/Home/Home.tsx'], denyShell: ['sed -i "" s/a/b/ android/app/build.gradle', 'cp x android/x', 'echo x > ios/Podfile'], askShell: ['eas build --platform android'], allowShell: ['npx expo start', 'npx expo run:android'] },
};
