import {nearbyWalkingPlaces} from '../src/navigation';
import {type Place} from '../src/mapsApi';

const origin = {latitude: 31.634, longitude: 74.872};
const place = (id: string, latitude: number, longitude: number): Place => ({
  id, name: 'Heritage Street', address: id, point: {latitude, longitude},
});

test('walking search keeps local places and excludes same-name places abroad', () => {
  const results = nearbyWalkingPlaces([
    place('Melbourne', -37.77, 144.91),
    place('Amritsar', 31.6257, 74.879),
    place('Texas', 29.55, -98.48),
  ], origin);
  expect(results.map(result => result.id)).toEqual(['Amritsar']);
});
