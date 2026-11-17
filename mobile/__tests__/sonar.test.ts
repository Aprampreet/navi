import {acousticAnnouncement, parseAcousticMeasurement} from '../src/sonar';

test('accepts a consistent native acoustic result and rounds to half metres', () => {
  expect(parseAcousticMeasurement({distanceMeters: 2.24, confidence: 0.61,
    distanceReliable: true, reflectionStrength: 'strong', responseRatio: 4.2,
    readings: 3, latencyMs: 920, spreadMeters: 0.12})).toMatchObject({
    roundedMeters: 2, confidenceLabel: 'strong',
  });
  expect(parseAcousticMeasurement({distanceMeters: 2.29, confidence: 0.35,
    distanceReliable: true, reflectionStrength: 'moderate', responseRatio: 2.3,
    readings: 2, latencyMs: 1100, spreadMeters: 0.3})).toMatchObject({
    roundedMeters: 2.5, confidenceLabel: 'moderate',
  });
});

test('rejects unsafe or malformed acoustic readings', () => {
  expect(parseAcousticMeasurement({distanceMeters: 8, confidence: 0.9,
    distanceReliable: true, reflectionStrength: 'strong', responseRatio: 4,
    readings: 3, latencyMs: 500, spreadMeters: 0.1})).toBeNull();
  expect(parseAcousticMeasurement({distanceMeters: 2, confidence: 0.1,
    distanceReliable: true, reflectionStrength: 'weak', responseRatio: 1.2,
    readings: 3, latencyMs: 500, spreadMeters: 0.1})).toBeNull();
  expect(parseAcousticMeasurement({distanceMeters: 2, confidence: 0.8,
    distanceReliable: true, reflectionStrength: 'strong', responseRatio: 5,
    readings: 1, latencyMs: 500, spreadMeters: 0.1})).toBeNull();
});

test('keeps visual identity separate from the acoustic reflection', () => {
  const result = parseAcousticMeasurement({distanceMeters: 1.08, confidence: 0.7,
    distanceReliable: true, reflectionStrength: 'strong', responseRatio: 5,
    readings: 3, latencyMs: 800, spreadMeters: 0.08})!;
  expect(acousticAnnouncement(result, '1 person · 2 chairs')).toBe(
    'A person is visible in the camera view. Experimental acoustic estimate: a nearby reflection is approximately 1 metre away. This is not a verified person distance.');
  expect(acousticAnnouncement(result, '1 chair')).not.toMatch(/^A person is visible/);
});

test('reports useful reflection data without inventing a distance', () => {
  const result = parseAcousticMeasurement({distanceMeters: null, distanceReliable: false,
    reflectionStrength: 'moderate', responseRatio: 2.4, confidence: 0, readings: 3,
    latencyMs: 910, spreadMeters: 0})!;
  expect(result).toMatchObject({roundedMeters: null, confidenceLabel: 'uncertain'});
  expect(acousticAnnouncement(result, '1 chair')).toBe(
    'Experimental acoustic scan: a moderate reflection response was detected, but this phone could not verify a distance. Do not use this result for safe movement.');
});
