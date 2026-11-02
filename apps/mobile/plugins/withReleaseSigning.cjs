/**
 * Injects an env-driven upload-key signing config into the generated Android
 * project. Direct test builds keep the existing internal debug certificate when
 * the variables are absent. Store builds must provide:
 *   LASTCALL_RELEASE_KEYSTORE, LASTCALL_KEYSTORE_PASSWORD,
 *   LASTCALL_KEY_ALIAS, LASTCALL_KEY_PASSWORD
 * The keystore and passwords stay outside the repository.
 */
const { withAppBuildGradle } = require('@expo/config-plugins');

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    const marker = '// LASTCALL_RELEASE_SIGNING';
    if (cfg.modResults.contents.includes(marker)) return cfg;
    cfg.modResults.contents += `

${marker}
def lastcallUploadKey = System.getenv("LASTCALL_RELEASE_KEYSTORE")
if (lastcallUploadKey) {
  android {
    signingConfigs {
      release {
        storeFile file(lastcallUploadKey)
        storePassword System.getenv("LASTCALL_KEYSTORE_PASSWORD")
        keyAlias System.getenv("LASTCALL_KEY_ALIAS")
        keyPassword System.getenv("LASTCALL_KEY_PASSWORD")
      }
    }
    buildTypes {
      release {
        signingConfig signingConfigs.release
      }
    }
  }
}
`;
    return cfg;
  });
};
