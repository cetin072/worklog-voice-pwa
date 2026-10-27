// Icon selection only: package, scheme, version and signing remain in app.json.
module.exports = ({ config }) => {
  const qa = process.env.WORKLOG_ICON_VARIANT === 'qa';
  const name = qa ? 'worklog-qa-launcher' : 'worklog-launcher';
  return {
    ...config,
    icon: `./assets/icons/${name}-1024.png`,
    android: {
      ...config.android,
      icon: `./assets/icons/${name}-1024.png`,
      adaptiveIcon: {
        foregroundImage: `./assets/icons/${name}-adaptive.png`,
        backgroundColor: '#103244',
      },
    },
  };
};
