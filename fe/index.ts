import { AppRegistry, Platform } from 'react-native';
import App from './App';

// Register the app component
AppRegistry.registerComponent('main', () => App);

// For web platform, run the application
if (Platform.OS === 'web') {
  // Wait for DOM to be ready
  if (typeof document !== 'undefined') {
    const rootTag =
      document.getElementById('root') || document.getElementById('main');
    if (rootTag) {
      AppRegistry.runApplication('main', {
        initialProps: {},
        rootTag,
      });
    } else {
      // If root element doesn't exist, create it
      const root = document.createElement('div');
      root.id = 'root';
      document.body.appendChild(root);
      AppRegistry.runApplication('main', {
        initialProps: {},
        rootTag: root,
      });
    }
  }
}
