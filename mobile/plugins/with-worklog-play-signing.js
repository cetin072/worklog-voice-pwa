const fs = require('node:fs');
const path = require('node:path');
const { withDangerousMod } = require('@expo/config-plugins');

const APPLY_LINE = 'apply from: file("worklog-play-signing.gradle")';

const SIGNING_GRADLE = `def worklogPlaySigningEnabled = System.getenv("WORKLOG_PLAY_SIGNING") == "1"

if (worklogPlaySigningEnabled) {
    def requiredSigningEnvironment = [
        "WORKLOG_PLAY_KEYSTORE_PATH",
        "WORKLOG_PLAY_STORE_PASSWORD",
        "WORKLOG_PLAY_KEY_ALIAS",
        "WORKLOG_PLAY_KEY_PASSWORD",
    ]
    def missingSigningEnvironment = requiredSigningEnvironment.findAll {
        def value = System.getenv(it)
        value == null || value.trim().isEmpty()
    }
    if (!missingSigningEnvironment.isEmpty()) {
        throw new GradleException("Missing Worklog Play signing environment: " + missingSigningEnvironment.join(", "))
    }

    def worklogPlayRelease = android.signingConfigs.findByName("worklogPlayRelease")
    if (worklogPlayRelease == null) {
        worklogPlayRelease = android.signingConfigs.create("worklogPlayRelease")
    }

    worklogPlayRelease.storeFile = project.file(System.getenv("WORKLOG_PLAY_KEYSTORE_PATH"))
    worklogPlayRelease.storePassword = System.getenv("WORKLOG_PLAY_STORE_PASSWORD")
    worklogPlayRelease.keyAlias = System.getenv("WORKLOG_PLAY_KEY_ALIAS")
    worklogPlayRelease.keyPassword = System.getenv("WORKLOG_PLAY_KEY_PASSWORD")

    android.buildTypes.getByName("release").signingConfig = worklogPlayRelease
}
`;

module.exports = function withWorklogPlaySigning(config) {
  return withDangerousMod(config, [
    'android',
    async (nextConfig) => {
      const appRoot = path.join(nextConfig.modRequest.platformProjectRoot, 'app');
      const buildGradlePath = path.join(appRoot, 'build.gradle');
      const signingGradlePath = path.join(appRoot, 'worklog-play-signing.gradle');

      let buildGradle = await fs.promises.readFile(buildGradlePath, 'utf8');
      if (!buildGradle.includes(APPLY_LINE)) {
        buildGradle = `${buildGradle.trimEnd()}\n\n// Worklog Play upload signing. No-op unless WORKLOG_PLAY_SIGNING=1.\n${APPLY_LINE}\n`;
        await fs.promises.writeFile(buildGradlePath, buildGradle, 'utf8');
      }

      await fs.promises.writeFile(signingGradlePath, SIGNING_GRADLE, 'utf8');
      return nextConfig;
    },
  ]);
};
