import {requireNativeComponent} from 'react-native';

// Keep native view registration outside App.tsx so Fast Refresh of the screen
// does not register the same view name a second time.
export const CameraView = requireNativeComponent<{active: boolean; style: object}>('NaviCameraView');
