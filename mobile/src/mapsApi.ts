import {type Point, type RouteStep} from './navigation';

declare const process: {env: {EXPO_PUBLIC_NAVI_PROXY_URL?: string}};

// Public proxy address only. Optional openrouteservice key stays on the proxy.
export const PROXY_URL = process.env.EXPO_PUBLIC_NAVI_PROXY_URL || 'http://10.0.2.2:8787';
export type Place = {id: string; name: string; address: string; point: Point};
async function post(path: string, payload: object): Promise<any> {
  let response: Response;
  try {
    response = await fetch(`${PROXY_URL}${path}`, {method: 'POST',
      headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload)});
  } catch {
    throw new Error('Map service unavailable. Start the NAVI proxy and check its phone connection.');
  }
  const json = await response.json();
  if (!response.ok) throw new Error(json.error?.message || json.error || `Maps error ${response.status}`);
  return json;
}
export async function searchPlaces(query: string, origin: Point): Promise<Place[]> {
  const data = await post('/places', {query, origin});
  return (data.places || []).filter((p: Place) => Number.isFinite(p.point?.latitude) &&
    Number.isFinite(p.point?.longitude));
}
export async function walkingRoute(origin: Point, destination: Point): Promise<{
  points: Point[]; steps: RouteStep[]}> {
  const data = await post('/route', {origin, destination});
  if (!Array.isArray(data.points) || data.points.length < 2 ||
      !Array.isArray(data.steps) || data.steps.length === 0) throw new Error('No walking route found');
  return {points: data.points, steps: data.steps};
}
