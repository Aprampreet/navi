export type Command =
  | {type: 'destination'; destination: string}
  | {type: 'stop' | 'repeat' | 'pause'}
  | {type: 'unknown'};

export function parseCommand(input: string): Command {
  const text = input.trim().replace(/[.!?]+$/, '').trim();
  if (/^stop(?: navigation| assistance)?$/i.test(text)) return {type: 'stop'};
  if (/^repeat(?: instruction)?$/i.test(text)) return {type: 'repeat'};
  if (/^pause(?: obstacle)? alerts?$/i.test(text)) return {type: 'pause'};
  const match = text.match(/^(?:let['’]?s go to|navigate(?: me)? to|go to|take me to|directions to)\s+(.+)$/i);
  return match?.[1]?.trim()
    ? {type: 'destination', destination: match[1].trim()}
    : {type: 'unknown'};
}

export type Point = {latitude: number; longitude: number};
export type RouteStep = {point: Point; instruction: string; distanceMeters: number};
export const MAX_WALKING_SEARCH_METERS = 30000;

export function nearbyWalkingPlaces<T extends {point: Point}>(places: T[], origin: Point): T[] {
  return places.filter(place => Number.isFinite(place.point?.latitude) &&
    Number.isFinite(place.point?.longitude) &&
    distanceMeters(origin, place.point) <= MAX_WALKING_SEARCH_METERS)
    .sort((a, b) => distanceMeters(origin, a.point) - distanceMeters(origin, b.point));
}

export function decodePolyline(encoded: string): Point[] {
  const points: Point[] = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    const next = () => {
      let result = 0, shift = 0, b: number;
      do {
        if (index >= encoded.length) throw new Error('Invalid polyline');
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      return result & 1 ? ~(result >> 1) : result >> 1;
    };
    lat += next(); lng += next();
    points.push({latitude: lat / 1e5, longitude: lng / 1e5});
  }
  return points;
}

export function distanceMeters(a: Point, b: Point): number {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLng = (b.longitude - a.longitude) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) *
    Math.cos(b.latitude * rad) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function shouldAdvanceStep(position: Point, step: RouteStep, accuracy: number): boolean {
  return accuracy <= 35 && distanceMeters(position, step.point) <= Math.max(18, accuracy);
}

export function formatInstruction(text: string): string {
  return text.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}
