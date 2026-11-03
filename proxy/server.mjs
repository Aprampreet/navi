import http from 'node:http';

const port = Number(process.env.PORT || 8787);
const orsKey = process.env.ORS_API_KEY;
const userAgent = process.env.NAVI_USER_AGENT || 'NAVI-Prototype/0.1 (single-device development)';
const cache = new Map();
let nextPublicRequest = 0;
let publicQueue = Promise.resolve();

const validPoint = p => p && Number.isFinite(p.latitude) && Number.isFinite(p.longitude) &&
  Math.abs(p.latitude) <= 90 && Math.abs(p.longitude) <= 180;
const point = coordinates => ({latitude: coordinates[1], longitude: coordinates[0]});
const walkingSearchRadiusMeters = 30000;
const distanceMeters = (a, b) => {
  const radians = Math.PI / 180;
  const latitude = (b.latitude - a.latitude) * radians;
  const longitude = (b.longitude - a.longitude) * radians;
  const h = Math.sin(latitude / 2) ** 2 + Math.cos(a.latitude * radians) *
    Math.cos(b.latitude * radians) * Math.sin(longitude / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};
export const nearbyWalkingPlaces = (places, origin) => places
  .filter(place => validPoint(place.point) && distanceMeters(origin, place.point) <= walkingSearchRadiusMeters)
  .sort((a, b) => distanceMeters(origin, a.point) - distanceMeters(origin, b.point));
const send = (res, status, body) => {
  res.writeHead(status, {'Content-Type': 'application/json'});
  res.end(JSON.stringify(body));
};

async function upstream(url, options = {}, publicDemo = false) {
  const call = async () => {
    if (publicDemo) {
      const delay = nextPublicRequest - Date.now();
      if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
      nextPublicRequest = Date.now() + 1100;
    }
    const response = await fetch(url, {...options, signal: AbortSignal.timeout(15000)});
    let body;
    try { body = await response.json(); } catch { throw new Error(`Map service returned HTTP ${response.status}`); }
    if (!response.ok || body.error) {
      throw new Error(typeof body.error === 'string' ? body.error :
        body.error?.message || `Map service returned HTTP ${response.status}`);
    }
    return body;
  };
  if (!publicDemo) return call();
  const result = publicQueue.then(call);
  publicQueue = result.catch(() => {});
  return result;
}

async function searchPlaces(query, origin) {
  const cacheKey = `places:${query.toLowerCase()}:${origin.latitude.toFixed(2)}:${origin.longitude.toFixed(2)}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.value;
  let places;
  if (orsKey) {
    const url = new URL('https://api.heigit.org/pelias/v1/search');
    url.searchParams.set('text', query);
    url.searchParams.set('size', '5');
    url.searchParams.set('focus.point.lat', String(origin.latitude));
    url.searchParams.set('focus.point.lon', String(origin.longitude));
    const data = await upstream(url, {headers: {Authorization: orsKey}});
    places = (data.features || []).filter(f => Array.isArray(f.geometry?.coordinates)).map(f => ({
      id: String(f.properties?.gid || f.id),
      name: f.properties?.name || f.properties?.label || query,
      address: f.properties?.label || '', point: point(f.geometry.coordinates),
    }));
  } else {
    places = await nominatimSearch(query, origin);
    places = nearbyWalkingPlaces(places, origin);
    // Heritage Street is a corridor, not a single mapped POI. Offer its
    // Town Hall entrance as an explicitly approximate, confirmable result.
    if (!places.length && /heritage\s+(?:street|walk)/i.test(query) &&
        (Math.abs(origin.latitude - 31.6257) < 0.2 && Math.abs(origin.longitude - 74.879) < 0.2)) {
      const entrance = (await nominatimSearch('Partition Museum Amritsar', origin))
        .find(p => p.name.toLowerCase() === 'partition museum');
      if (entrance) places = [{...entrance, id: 'heritage-street-town-hall-entrance',
        name: 'Heritage Street (Town Hall entrance)',
        address: 'Near Partition Museum, Amritsar · approximate entrance'}];
    }
  }
  places = nearbyWalkingPlaces(places, origin);
  cache.set(cacheKey, {value: places, expires: Date.now() + 10 * 60_000});
  return places;
}

async function nominatimSearch(query, origin) {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '5');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('viewbox', `${origin.longitude - 0.2},${origin.latitude + 0.2},${origin.longitude + 0.2},${origin.latitude - 0.2}`);
  const data = await upstream(url, {headers: {'User-Agent': userAgent, 'Accept-Language': 'en'}}, true);
  return data.map(p => ({
      id: `${p.osm_type}-${p.osm_id}`,
      name: p.name || p.display_name?.split(',')[0] || query,
      address: p.display_name || '',
      point: {latitude: Number(p.lat), longitude: Number(p.lon)},
    })).filter(p => validPoint(p.point));
}

export async function walkingRoute(origin, destination) {
  if (distanceMeters(origin, destination) > walkingSearchRadiusMeters)
    throw new Error('Destination is too far for a walking route from your current GPS location');
  if (orsKey) {
    const data = await upstream('https://api.heigit.org/openrouteservice/v2/directions/foot-walking/geojson', {
      method: 'POST', headers: {'Content-Type': 'application/json', Authorization: orsKey},
      body: JSON.stringify({coordinates: [[origin.longitude, origin.latitude],
        [destination.longitude, destination.latitude]], language: 'en'}),
    });
    const feature = data.features?.[0];
    if (!feature?.geometry?.coordinates?.length) throw new Error('No walking route found');
    return {
      points: feature.geometry.coordinates.map(point),
      steps: (feature.properties?.segments || []).flatMap(segment => segment.steps || []).map(step => ({
        point: point(step.maneuver?.location || feature.geometry.coordinates[step.way_points?.[0] || 0]),
        instruction: step.instruction, distanceMeters: step.distance || 0,
      })),
    };
  }
  const url = new URL('https://valhalla1.openstreetmap.de/route');
  url.searchParams.set('json', JSON.stringify({
    locations: [{lat: origin.latitude, lon: origin.longitude},
      {lat: destination.latitude, lon: destination.longitude}],
    costing: 'pedestrian', units: 'kilometers', language: 'en-US',
  }));
  const data = await upstream(url, {headers: {'User-Agent': userAgent, 'X-Client-Id': 'NAVI-Prototype'}}, true);
  const leg = data.trip?.legs?.[0];
  if (!leg?.shape || !leg.maneuvers?.length) throw new Error('No walking route found');
  const points = decodePolyline6(leg.shape);
  return {points, steps: leg.maneuvers.map(m => ({
    point: points[m.begin_shape_index] || destination,
    instruction: m.verbal_pre_transition_instruction || m.instruction,
    distanceMeters: Math.round((m.length || 0) * 1000),
  }))};
}

export function decodePolyline6(encoded) {
  const points = [];
  let index = 0, lat = 0, lon = 0;
  while (index < encoded.length) {
    const read = () => {
      let value = 0, shift = 0, b;
      do {
        if (index >= encoded.length) throw new Error('Invalid route shape');
        b = encoded.charCodeAt(index++) - 63;
        value |= (b & 31) << shift;
        shift += 5;
      } while (b >= 32);
      return value & 1 ? ~(value >> 1) : value >> 1;
    };
    lat += read(); lon += read();
    points.push({latitude: lat / 1e6, longitude: lon / 1e6});
  }
  return points;
}

if (process.env.NODE_ENV !== 'test') http.createServer(async (req, res) => {
  if (req.method !== 'POST' || !['/places', '/route'].includes(req.url)) {
    send(res, 404, {error: 'Not found'}); return;
  }
  try {
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 4096) throw new Error('Request too large');
    }
    const data = JSON.parse(body);
    if (req.url === '/places') {
      if (typeof data.query !== 'string' || !data.query.trim() || data.query.length > 120 || !validPoint(data.origin))
        throw new Error('Invalid place search');
      send(res, 200, {places: await searchPlaces(data.query.trim(), data.origin)});
    } else {
      if (!validPoint(data.origin) || !validPoint(data.destination)) throw new Error('Invalid coordinates');
      send(res, 200, await walkingRoute(data.origin, data.destination));
    }
  } catch (error) { send(res, 400, {error: error.message || 'Request failed'}); }
}).listen(port, process.env.HOST || '127.0.0.1', () =>
  console.log(`NAVI ${orsKey ? 'openrouteservice' : 'public demo'} proxy listening on ${port}`));
