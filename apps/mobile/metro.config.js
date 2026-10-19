const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');
const uiSource = path.resolve(workspaceRoot, 'packages/ui/src');

/*
 * @brot/ui exports only `./tokens` as a DOM-free entry. Its package root also pulls in the web
 * components and their own React copy, so the app maps the DOM-free geometry modules by file.
 */
const UI_MODULES = {
  '@brot/ui/avatar': path.join(uiSource, 'avatar.ts'),
  '@brot/ui/blink': path.join(uiSource, 'blink.ts'),
};

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.unstable_enableSymlinks = true;
config.resolver.unstable_enablePackageExports = true;

const upstreamResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === '@brot/ui' || moduleName === '@brot/ui/index') {
    throw new Error('Import DOM-free modules from @brot/ui/tokens, @brot/ui/avatar or @brot/ui/blink in the mobile app.');
  }
  const mapped = UI_MODULES[moduleName];
  if (mapped) return { type: 'sourceFile', filePath: mapped };
  return upstreamResolve ? upstreamResolve(context, moduleName, platform) : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
