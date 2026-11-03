const origin = {latitude: 31.634, longitude: 74.872};

jest.mock('expo/virtual/env', () => ({env: {}}));

beforeEach(() => {
  jest.resetModules();
  globalThis.fetch = jest.fn();
});

test('standalone place search uses the public geocoder and filters distant results', async () => {
  (globalThis.fetch as jest.Mock).mockResolvedValue({ok: true, status: 200, json: async () => [
    {osm_type: 'node', osm_id: 1, name: 'Nearby', display_name: 'Nearby, Amritsar',
      lat: '31.6257', lon: '74.879'},
    {osm_type: 'node', osm_id: 2, name: 'Far away', display_name: 'Far away',
      lat: '-37.77', lon: '144.91'},
  ]});
  const {PROXY_URL, searchPlaces} = require('../src/mapsApi');
  const places = await searchPlaces('Heritage Street Amritsar', origin);
  expect(PROXY_URL).toBe('');
  expect(places.map((place: any) => place.name)).toEqual(['Nearby']);
  expect(globalThis.fetch).toHaveBeenCalledWith(expect.stringContaining('nominatim.openstreetmap.org'),
    expect.objectContaining({signal: expect.anything()}));
});

test('standalone walking route decodes Valhalla geometry and instructions', async () => {
  (globalThis.fetch as jest.Mock).mockResolvedValue({ok: true, status: 200, json: async () => ({trip: {legs: [{
    shape: '??gE?',
    maneuvers: [{begin_shape_index: 0, instruction: 'Walk north', length: 0.12}],
  }]}})});
  const {walkingRoute} = require('../src/mapsApi');
  const route = await walkingRoute(origin, {latitude: 31.635, longitude: 74.872});
  expect(route.points).toEqual([{latitude: 0, longitude: 0}, {latitude: 0.0001, longitude: 0}]);
  expect(route.steps[0]).toMatchObject({instruction: 'Walk north', distanceMeters: 120});
  expect(globalThis.fetch).toHaveBeenCalledWith(expect.stringContaining('valhalla1.openstreetmap.de/route'),
    expect.objectContaining({signal: expect.anything()}));
});

test('standalone map failures explain that only navigation needs internet', async () => {
  (globalThis.fetch as jest.Mock).mockRejectedValue(new TypeError('Network request failed'));
  const {searchPlaces} = require('../src/mapsApi');
  await expect(searchPlaces('Museum', origin)).rejects.toThrow(
    'Navigation requires an internet connection. Camera assistance remains available offline.');
});
