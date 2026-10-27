const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');
// Expo SDK 58 resolves workspace packages and hoisted native dependencies itself.
// Keep the default resolver so React and native modules have a single identity.
const config = getDefaultConfig(__dirname);
const coreSource = path.resolve(__dirname, '../../packages/core/src') + path.sep;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Shared core uses Node ESM-compatible .js specifiers in TypeScript source.
  // Unlike TypeScript/Vite, Metro does not map these to their .ts source files.
  if (context.originModulePath.startsWith(coreSource) && moduleName.startsWith('./') && moduleName.endsWith('.js')) {
    return context.resolveRequest(context, moduleName.slice(0, -3) + '.ts', platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};
module.exports = config;
