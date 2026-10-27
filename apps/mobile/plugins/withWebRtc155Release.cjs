const { withAppBuildGradle, withDangerousMod } = require('expo/config-plugins');
const fs = require('node:fs/promises');
const path = require('node:path');

const marker = 'messenger-webrtc-155-orphan-jni';
const rules = `\n# ${marker}\n# org.jitsi:webrtc:155.0.1 includes an orphan Dav1dDecoderJni but omits its\n# Dav1dDecoder wrapper/interface. SoftwareVideoDecoderFactory calls its own\n# native factory instead. See README.md; do not broaden this suppression.\n-dontwarn org.webrtc.Dav1dDecoder$Natives\n`;

module.exports = function withWebRtc155Release(config) {
  config = withAppBuildGradle(config, mod => {
    if (mod.modResults.language !== 'groovy') {
      throw new Error('WebRTC 155 release workaround requires a Groovy app build.gradle.');
    }
    if (!mod.modResults.contents.includes(marker)) {
      mod.modResults.contents += `\n// ${marker}\n// The upstream React Native module declares 155.+; pin the AAR inspected\n// for this narrowly scoped orphan-JNI R8 workaround. Review on upgrades.\ndependencies {\n    constraints {\n        implementation('org.jitsi:webrtc:155.0.1') {\n            version { strictly '155.0.1' }\n            because 'Verified WebRTC AAR for the orphan Dav1d JNI release workaround'\n        }\n    }\n}\n`;
    }
    return mod;
  });
  return withDangerousMod(config, ['android', async mod => {
    const target = path.join(mod.modRequest.platformProjectRoot, 'app', 'proguard-rules.pro');
    const current = await fs.readFile(target, 'utf8');
    if (!current.includes(marker)) await fs.writeFile(target, current + rules);
    return mod;
  }]);
};
