import { AppRegistry, LogBox } from 'react-native';
import { W3CLibPolyfill } from '@amazon-devices/react-native-w3cmedia';
import { App } from './src/App';
import { name as appName } from './app.json';

// Installs MediaSource / URL.createObjectURL globals used by the MSE video sink.
W3CLibPolyfill.install();

// Temporary workaround for problem with nested text
// not working currently.
LogBox.ignoreAllLogs();

AppRegistry.registerComponent(appName, () => App);
