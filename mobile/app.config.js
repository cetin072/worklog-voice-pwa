const fs = require('node:fs');
const path = require('node:path');

// Build-only selection. It never changes package, auth, scheme or backend.
// "existing" preserves the currently configured icons until approved bytes arrive.
module.exports = ({ config }) => {
  const variant = process.env.WORKLOG_ICON_VARIANT || 'existing';
  if (variant === 'existing') return config;
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
  if (config.android?.adaptiveIcon) {
    throw new Error('Validate the selected opaque icon against the existing adaptive layers before building');
  }
  return {
    ...config,
    icon,
    android: { ...config.android, icon },
    ios: { ...config.ios, icon },
    web: { ...config.web, favicon: icon },
  };
};
