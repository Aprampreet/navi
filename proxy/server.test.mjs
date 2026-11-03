import assert from 'node:assert/strict';
import test from 'node:test';
import {nearbyWalkingPlaces, walkingRoute} from './server.mjs';

const origin = {latitude: 31.634, longitude: 74.872};
const place = (name, latitude, longitude) => ({name, point: {latitude, longitude}});

test('walking search excludes matching street names in distant cities', () => {
  const results = nearbyWalkingPlaces([
    place('Heritage Street Melbourne', -37.77, 144.91),
    place('Heritage Street Amritsar', 31.6257, 74.879),
    place('Heritage Street Texas', 29.55, -98.48),
  ], origin);
  assert.deepEqual(results.map(result => result.name), ['Heritage Street Amritsar']);
});

test('walking route refuses a destination far from current GPS', async () => {
  await assert.rejects(walkingRoute(origin, {latitude: -37.77, longitude: 144.91}),
    /too far for a walking route/);
});
