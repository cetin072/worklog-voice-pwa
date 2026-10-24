const fs = require('node:fs');
const path = require('node:path');

// Android QA has its own install identity and deep-link scheme, not its own backend.
// Production/default keeps the original config object and package unchanged.
module.exports = ({ config }) => {
  const appVariant = process.env.EXPO_PUBLIC_WORKLOG_APP_VARIANT || 'production';
  if (appVariant !== 'production' && appVariant !== 'qa') {
    throw new Error('EXPO_PUBLIC_WORKLOG_APP_VARIANT must be production or qa');
  }
  const selectedConfig = appVariant === 'qa'
    ? {
        ...config,
        name: '업무수첩 QA',
        scheme: 'worklog-qa',
        android: { ...config.android, package: 'com.cetin072.worklog.qa' },
      }
    : config;

  // "existing" preserves configured icons until approved bytes arrive.
  const variant = process.env.WORKLOG_ICON_VARIANT || 'existing';
  if (variant === 'existing') return selectedConfig;
  const assets = {
    base: './assets/worklog-launcher-1024.png',
    qa: './assets/worklog-qa-launcher-1024.png',
  };
  if (!Object.hasOwn(assets, variant)) throw new Error('WORKLOG_ICON_VARIANT must be existing, base, or qa');
  const icon = assets[variant];
  if (!fs.existsSync(path.join(__dirname, icon))) {
    throw new Error(`Approved ${variant} icon is not available locally: ${icon}. Materialize and visually validate the original first.`);
  }
  // Both approved originals are opaque. Do not claim they are transparent
  // foreground layers or reuse an unrelated adaptive layer for the QA build.
  if (selectedConfig.android?.adaptiveIcon) {
    throw new Error('Validate the selected opaque icon against the existing adaptive layers before building');
  }
  return {
    ...selectedConfig,
    icon,
    android: { ...selectedConfig.android, icon },
    ios: { ...selectedConfig.ios, icon },
    web: { ...selectedConfig.web, favicon: icon },
  };
};
