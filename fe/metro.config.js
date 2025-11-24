const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

module.exports = (() => {
  const projectRoot = __dirname;
  const workspaceRoot = path.resolve(projectRoot, '..');

  // Obtener configuración base de Expo para este directorio específico
  const config = getDefaultConfig(projectRoot);

  const { transformer, resolver } = config;

  config.transformer = {
    ...transformer,
    babelTransformerPath: require.resolve('react-native-svg-transformer'),
  };

  config.resolver = {
    ...resolver,
    assetExts: resolver.assetExts.filter((ext) => ext !== 'svg'),
    sourceExts: [...resolver.sourceExts, 'svg'],
    alias: {
      'react-native-maps': '@teovilla/react-native-web-maps',
    },
    // Configuración específica para monorepo
    unstable_enableSymlinks: true,
    platforms: ['ios', 'android', 'native', 'web'],
  };

  config.resolver.nodeModulesPaths = [
    path.resolve(projectRoot, 'node_modules'),
    path.resolve(workspaceRoot, 'node_modules'),
  ];

  // Solo vigilar el directorio del proyecto y el workspace root
  config.watchFolders = [projectRoot, workspaceRoot];

  return config;
})();
