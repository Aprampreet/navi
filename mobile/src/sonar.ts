export type AcousticMeasurement = {
  distanceMeters: number | null;
  distanceReliable: boolean;
  reflectionStrength: 'weak' | 'moderate' | 'strong';
  responseRatio: number;
  confidence: number;
  readings: number;
  latencyMs: number;
  spreadMeters: number;
};

export type AcousticResult = AcousticMeasurement & {
  roundedMeters: number | null;
  confidenceLabel: 'uncertain' | 'moderate' | 'strong';
};

export function parseAcousticMeasurement(value: unknown): AcousticResult | null {
  const item = value as Partial<AcousticMeasurement> | null;
  if (!item || typeof item.distanceReliable !== 'boolean' ||
      !['weak', 'moderate', 'strong'].includes(String(item.reflectionStrength)) ||
      !Number.isFinite(item.responseRatio) || item.responseRatio! < 0 ||
      !Number.isFinite(item.confidence) ||
      !Number.isFinite(item.readings) || !Number.isFinite(item.latencyMs) ||
      !Number.isFinite(item.spreadMeters) || item.confidence! < 0 || item.confidence! > 1 ||
      item.readings! < 1 || item.spreadMeters! < 0 || item.spreadMeters! > 0.7) return null;
  if (item.distanceReliable && (!Number.isFinite(item.distanceMeters) ||
      item.distanceMeters! < 0.45 || item.distanceMeters! > 4 || item.confidence! < 0.18 ||
      item.readings! < 2)) return null;
  if (!item.distanceReliable && item.distanceMeters != null) return null;
  const roundedMeters = item.distanceReliable ? Math.round(item.distanceMeters! * 2) / 2 : null;
  return {
    distanceMeters: item.distanceMeters ?? null,
    distanceReliable: item.distanceReliable,
    reflectionStrength: item.reflectionStrength!,
    responseRatio: item.responseRatio!,
    confidence: item.confidence!,
    readings: Math.round(item.readings!),
    latencyMs: item.latencyMs!,
    spreadMeters: item.spreadMeters!,
    roundedMeters,
    confidenceLabel: !item.distanceReliable ? 'uncertain' :
      item.confidence! >= 0.5 && item.spreadMeters! <= 0.2 ? 'strong' : 'moderate',
  };
}

export function acousticAnnouncement(result: AcousticResult, currentScene: string): string {
  const visual = /(^|\W)(?:1 |one )?person|people/i.test(currentScene) ?
    'A person is visible in the camera view. ' : '';
  if (!result.distanceReliable || result.roundedMeters == null) {
    return `${visual}Experimental acoustic scan: a ${result.reflectionStrength} reflection response ` +
      'was detected, but this phone could not verify a distance. Do not use this result for safe movement.';
  }
  const metres = Number.isInteger(result.roundedMeters) ?
    String(result.roundedMeters) : result.roundedMeters.toFixed(1);
  return `${visual}Experimental acoustic estimate: a nearby reflection is approximately ` +
    `${metres} ${result.roundedMeters === 1 ? 'metre' : 'metres'} away. ` +
    'This is not a verified person distance.';
}
