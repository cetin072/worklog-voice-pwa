// Non-Play QA identity and approved launcher artwork share one config owner.
module.exports = ({ config }) => {
  const variant = process.env.EXPO_PUBLIC_WORKLOG_APP_VARIANT || 'production';
  if (!['production', 'qa'].includes(variant)) {
    throw new Error('EXPO_PUBLIC_WORKLOG_APP_VARIANT must be production or qa');
  }
  const qa = variant === 'qa';
  const name = qa || process.env.WORKLOG_ICON_VARIANT === 'qa'
    ? 'worklog-qa-launcher' : 'worklog-launcher';
  return {
    ...config,
    ...(qa ? { name: '업무수첩 QA', scheme: 'worklog-qa' } : {}),
    icon: `./assets/icons/${name}-1024.png`,
    android: {
      ...config.android,
      ...(qa ? {
        package: 'com.cetin072.worklog.qa',
        versionCode: Math.max(7, config.android.versionCode),
      } : {}),
      icon: `./assets/icons/${name}-1024.png`,
      adaptiveIcon: {
        foregroundImage: `./assets/icons/${name}-adaptive.png`,
        backgroundColor: '#103244',
      },
    },
  };
};

