import {NativeModules, PermissionsAndroid, Platform} from 'react-native';

export type NaviPermission = 'camera' | 'microphone' | 'location';

const androidPermission = {
  camera: PermissionsAndroid.PERMISSIONS.CAMERA,
  microphone: PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
  location: PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
} as const;

export async function checkPermission(permission: NaviPermission): Promise<boolean> {
  if (Platform.OS === 'android') return PermissionsAndroid.check(androidPermission[permission]);
  if (Platform.OS === 'ios') return Boolean(await NativeModules.NaviNative.checkPermission(permission));
  return false;
}

export async function requestPermission(permission: NaviPermission): Promise<boolean> {
  if (Platform.OS === 'android') {
    return (await PermissionsAndroid.request(androidPermission[permission])) ===
      PermissionsAndroid.RESULTS.GRANTED;
  }
  if (Platform.OS === 'ios') return Boolean(await NativeModules.NaviNative.requestPermission(permission));
  return false;
}

export async function requestAutomaticSmsPermission(): Promise<void> {
  if (Platform.OS === 'android')
    await PermissionsAndroid.request('android.permission.SEND_SMS' as never);
  // iOS always presents a user-confirmed Messages composer. It has no equivalent
  // permission for automatic SMS sending.
}
