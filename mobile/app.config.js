// Android non-Play builds use a separate QA identity; Play retains the original ID.
module.exports = ({ config }) => {
  const variant = process.env.EXPO_PUBLIC_WORKLOG_APP_VARIANT || 'production';
  if (variant === 'production') return config;
  if (variant !== 'qa') {
    throw new Error('EXPO_PUBLIC_WORKLOG_APP_VARIANT must be production or qa');
  }
  return {
    ...config,
    name: '업무수첩 QA',
    scheme: 'worklog-qa',
    android: {
      ...config.android,
      package: 'com.cetin072.worklog.qa',
      // Do not downgrade the already-installed side-by-side QA build (code 2).
      versionCode: Math.max(2, config.android.versionCode),
    },
  };
};
