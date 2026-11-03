import React from 'react';
import {requireNativeComponent, type ViewProps} from 'react-native';
import type {Point} from './navigation';

const NativeRouteMap = requireNativeComponent<{mapData: string} & ViewProps>('NaviMapView');

export function RouteMap({position, destination, route}: {
  position: Point | null; destination: Point | null; route: Point[];
}) {
  return <NativeRouteMap accessible={false} importantForAccessibility="no-hide-descendants"
    mapData={JSON.stringify({position, destination, route})} style={{flex: 1}} />;
}
