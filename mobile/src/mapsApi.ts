import {distanceMeters, MAX_WALKING_SEARCH_METERS, nearbyWalkingPlaces,
  type Point, type RouteStep} from './navigation';

declare const process: {env: {EXPO_PUBLIC_NAVI_PROXY_URL?: string}};

// A proxy is optional. Standalone release builds use the public map services
// directly, while USB development or a hosted deployment can supply a proxy.
export const PROXY_URL = process.env.EXPO_PUBLIC_NAVI_PROXY_URL?.trim() || '';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const VALHALLA_URL = 'https://valhalla1.openstreetmap.de/route';
const REQUEST_TIMEOUT_MS = 15000;
const PUBLIC_REQUEST_GAP_MS = 1100;
const USER_AGENT = 'NAVI-Prototype/0.1 (accessible walking assistant)';

export type Place = {id: string; name: string; address: string; point: Point};
type Route = {points: Point[]; steps: RouteStep[]};

const searchCache = new Map<string, {expires: number; places: Place[]}>();
let nextPublicRequest = 0;
let publicQueue: Promise<unknown> = Promise.resolve();

async function fetchJson(url: string, options: RequestInit = {}): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {...options, signal: controller.signal});
    let json: any;
    try { json = await response.json(); } catch { throw new Error(`Map service returned HTTP ${response.status}`); }
    if (!response.ok || json?.error) {
      throw new Error(typeof json?.error === 'string' ? json.error :
        json?.error?.message || `Map service returned HTTP ${response.status}`);
    }
    return json;
  } catch (error) {
    if (error instanceof Error && /Map service returned|No walking route/.test(error.message)) throw error;
    throw new Error('Navigation requires an internet connection. Camera assistance remains available offline.');
  } finally { clearTimeout(timeout); }
}

async function publicJson(url: string, options: RequestInit = {}): Promise<any> {
  const call = async () => {
    const delay = nextPublicRequest - Date.now();
    if (delay > 0) await new Promise<void>(resolve => setTimeout(resolve, delay));
    nextPublicRequest = Date.now() + PUBLIC_REQUEST_GAP_MS;
    return fetchJson(url, options);
  };
  const result = publicQueue.then(call, call);
  publicQueue = result.catch(() => undefined);
  return result;
}

async function post(path: string, payload: object): Promise<any> {
  return fetchJson(`${PROXY_URL}${path}`, {method: 'POST',
    headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload)});
}

function validPoint(point: Point): boolean {
  return Number.isFinite(point?.latitude) && Number.isFinite(point?.longitude) &&
    Math.abs(point.latitude) <= 90 && Math.abs(point.longitude) <= 180;
}

async function nominatimSearch(query: string, origin: Point): Promise<Place[]> {
  const longitude = origin.longitude;
  const latitude = origin.latitude;
  const url = `${NOMINATIM_URL}?q=${encodeURIComponent(query)}&format=jsonv2&limit=5` +
    `&addressdetails=1&viewbox=${longitude - 0.2},${latitude + 0.2},${longitude + 0.2},${latitude - 0.2}`;
  const data = await publicJson(url, {headers: {
    'User-Agent': USER_AGENT, 'Accept-Language': 'en', Accept: 'application/json',
  }});
  if (!Array.isArray(data)) return [];
  return data.map(item => ({
    id: `${item.osm_type}-${item.osm_id}`,
    name: item.name || item.display_name?.split(',')[0] || query,
    address: item.display_name || '',
    point: {latitude: Number(item.lat), longitude: Number(item.lon)},
  })).filter(place => validPoint(place.point));
}

async function directSearchPlaces(query: string, origin: Point): Promise<Place[]> {
  const cacheKey = `${query.toLowerCase()}:${origin.latitude.toFixed(2)}:${origin.longitude.toFixed(2)}`;
  const cached = searchCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.places;
  let places = nearbyWalkingPlaces(await nominatimSearch(query, origin), origin);

  // Heritage Street is a corridor rather than one mapped POI. Resolve its
  // approximate Town Hall entrance only when the user is already in Amritsar.
  if (!places.length && /heritage\s+(?:street|walk)/i.test(query) &&
      Math.abs(origin.latitude - 31.6257) < 0.2 && Math.abs(origin.longitude - 74.879) < 0.2) {
    const entrance = (await nominatimSearch('Partition Museum Amritsar', origin))
      .find(place => place.name.toLowerCase() === 'partition museum');
    if (entrance) places = [{...entrance, id: 'heritage-street-town-hall-entrance',
      name: 'Heritage Street (Town Hall entrance)',
      address: 'Near Partition Museum, Amritsar · approximate entrance'}];
  }
  places = nearbyWalkingPlaces(places, origin);
  searchCache.set(cacheKey, {places, expires: Date.now() + 10 * 60_000});
  return places;
}

export function decodePolyline6(encoded: string): Point[] {
  const points: Point[] = [];
  let index = 0, latitude = 0, longitude = 0;
  while (index < encoded.length) {
    const read = () => {
      let value = 0, shift = 0, byte: number;
      do {
        if (index >= encoded.length) throw new Error('Invalid route shape');
        byte = encoded.charCodeAt(index++) - 63;
        value |= (byte & 31) << shift;
        shift += 5;
      } while (byte >= 32);
      return value & 1 ? ~(value >> 1) : value >> 1;
    };
    latitude += read(); longitude += read();
    points.push({latitude: latitude / 1e6, longitude: longitude / 1e6});
  }
  return points;
}

async function directWalkingRoute(origin: Point, destination: Point): Promise<Route> {
  const request = JSON.stringify({
    locations: [{lat: origin.latitude, lon: origin.longitude},
      {lat: destination.latitude, lon: destination.longitude}],
    costing: 'pedestrian', units: 'kilometers', language: 'en-US',
  });
  const data = await publicJson(`${VALHALLA_URL}?json=${encodeURIComponent(request)}`, {headers: {
    'User-Agent': USER_AGENT, 'X-Client-Id': 'NAVI-Prototype', Accept: 'application/json',
  }});
  const leg = data.trip?.legs?.[0];
  if (!leg?.shape || !Array.isArray(leg.maneuvers) || !leg.maneuvers.length)
    throw new Error('No walking route found');
  const points = decodePolyline6(leg.shape);
  return {points, steps: leg.maneuvers.map((maneuver: any) => ({
    point: points[maneuver.begin_shape_index] || destination,
    instruction: maneuver.verbal_pre_transition_instruction || maneuver.instruction,
    distanceMeters: Math.round((maneuver.length || 0) * 1000),
  }))};
}

export async function searchPlaces(query: string, origin: Point): Promise<Place[]> {
  if (PROXY_URL) {
    const data = await post('/places', {query, origin});
    return nearbyWalkingPlaces(Array.isArray(data.places) ? data.places : [], origin);
  }
  return directSearchPlaces(query, origin);
}

export async function walkingRoute(origin: Point, destination: Point): Promise<Route> {
  if (distanceMeters(origin, destination) > MAX_WALKING_SEARCH_METERS)
    throw new Error('Destination is too far for a walking route from your current GPS location');
  if (PROXY_URL) {
    const data = await post('/route', {origin, destination});
    if (!Array.isArray(data.points) || data.points.length < 2 ||
        !Array.isArray(data.steps) || data.steps.length === 0) throw new Error('No walking route found');
    return {points: data.points, steps: data.steps};
  }
  return directWalkingRoute(origin, destination);
}
