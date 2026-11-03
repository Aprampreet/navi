import React from 'react';
import {Text, View, type ViewStyle} from 'react-native';
import {CameraView} from '../CameraView';
import type {CorridorFrame, CorridorZone} from '../corridor';
import {ActionButton, ScreenFrame, Section, StatusRow, type Theme} from '../ui/design';

export function AssistanceScreen({theme, style, assisting, cameraReady, paused, lastCue,
  lastReading, sceneSummary, approachNote, fps, latency, deliveryMs, error,
  corridor, corridorError,
  onStart, onPause, onStop, onRepeat, onDescribe, onVoice, onEndVoice, listening}: {
  theme: Theme; style?: ViewStyle; assisting: boolean; cameraReady: boolean; paused: boolean;
  lastCue: string; lastReading: string; sceneSummary: string; approachNote: string;
  fps: number | null; latency: number | null; deliveryMs: number | null; error: string;
  corridor: CorridorFrame | null; corridorError: string;
  onStart: () => void; onPause: () => void; onStop: () => void; onRepeat: () => void;
  onDescribe: () => void; onVoice: () => void; onEndVoice: () => void; listening: boolean;
}) {
  return <ScreenFrame title="Live assistance" theme={theme} style={style}
    description="Spoken scene changes are primary. The camera view is a visual reference.">
    <StatusRow label="Camera assistance" theme={theme}
      value={cameraReady ? 'Live' : assisting ? 'Starting' : 'Off'}
      tone={cameraReady ? 'positive' : assisting ? 'warning' : 'normal'} />
    {assisting ? <View importantForAccessibility="no-hide-descendants"
      style={{borderRadius: 18, borderWidth: 2, borderColor: theme.border,
      overflow: 'hidden', backgroundColor: theme.surface}}>
      <CameraView active={assisting} style={{height: 220, width: '100%'}} />
      {!!corridor && <View pointerEvents="none" style={{position: 'absolute', left: 0, right: 0,
        bottom: 0, height: '58%', flexDirection: 'row'}}>
        {corridor.zones.map(zone => <View key={zone.name} style={{flex: 1,
          borderLeftWidth: zone.name === 'LEFT' ? 0 : 1, borderColor: '#FFFFFF66',
          backgroundColor: corridorColor(zone)}}>
          <Text style={{color: '#FFFFFF', backgroundColor: '#00000099', paddingVertical: 3,
            fontSize: 10, fontWeight: '900', textAlign: 'center'}}>
            {zone.name} · {zoneLabel(zone)}
          </Text>
        </View>)}
      </View>}
    </View> : <View style={{padding: 24, borderWidth: 2, borderColor: theme.border,
      borderRadius: 18, backgroundColor: theme.surface}}>
      <Text style={{color: theme.secondary, fontSize: 17 * theme.scale,
        lineHeight: 24 * theme.scale}}>Start assistance to hear confirmed objects and visible text.</Text>
    </View>}

    {!!error && <Text accessibilityRole="alert" style={{color: theme.danger,
      fontSize: 16 * theme.scale, lineHeight: 23 * theme.scale}}>{error}</Text>}

    <Section title="Latest scene cue" theme={theme}>
      <Text style={{color: theme.text, fontSize: 24 * theme.scale, lineHeight: 31 * theme.scale,
        fontWeight: '800'}}>{lastCue || (assisting ? 'Looking for stable objects…' : 'No active camera cue')}</Text>
      {!!sceneSummary && <Text style={{color: theme.secondary, fontSize: 15 * theme.scale,
        lineHeight: 22 * theme.scale}}>In view: {sceneSummary}</Text>}
      {!!approachNote && <Text style={{color: theme.warning, fontSize: 14 * theme.scale}}>
        {approachNote}</Text>}
    </Section>

    <Section title="Visible text" theme={theme}>
      <Text style={{color: theme.text, fontSize: 18 * theme.scale,
        lineHeight: 26 * theme.scale}}>{lastReading || 'No verified reading yet'}</Text>
    </Section>

    <Section title="Walking-surface research preview" theme={theme}>
      <Text accessibilityRole="summary" style={{color: theme.text, fontSize: 17 * theme.scale,
        lineHeight: 24 * theme.scale, fontWeight: '700'}}>
        {corridor?.summary || (assisting ? 'Assessing the camera image…' : 'Not active')}
      </Text>
      <Text style={{color: theme.secondary, fontSize: 13 * theme.scale, lineHeight: 19 * theme.scale}}>
        Camera-image evidence only. This does not identify a safe or physically clear path.
      </Text>
      {!!corridor && <Text style={{color: theme.secondary, fontSize: 13 * theme.scale,
        lineHeight: 19 * theme.scale}}>{corridor.zones.map(zone =>
          `${titleCase(zone.name)}: ${zoneLabel(zone).toLowerCase()}`).join(' · ')}</Text>}
      {!!corridorError && <Text accessibilityRole="alert" style={{color: theme.warning,
        fontSize: 13 * theme.scale}}>Surface preview unavailable: {corridorError}</Text>}
    </Section>

    <Section title="Controls" theme={theme}>
      {!assisting && <ActionButton label="Start camera assistance" theme={theme} primary
        onPress={onStart} />}
      {assisting && <ActionButton label={paused ? 'Resume camera and text alerts' : 'Pause camera and text alerts'}
        theme={theme} onPress={onPause} />}
      <ActionButton label="Describe current surroundings" theme={theme} onPress={onDescribe}
        disabled={!cameraReady} />
      <ActionButton label="Repeat last announcement" theme={theme} onPress={onRepeat}
        disabled={!lastCue && !lastReading} />
      <ActionButton label={listening ? 'Listening for a command' : 'Speak a command'}
        theme={theme} onPress={onVoice} disabled={listening} />
      {listening && <ActionButton label="End voice session" theme={theme} onPress={onEndVoice} />}
      {assisting && <ActionButton label="Stop camera assistance" theme={theme} danger
        onPress={onStop} />}
    </Section>

    <StatusRow label="Camera processing" theme={theme}
      value={latency === null ? 'Waiting for frames' : `${fps ?? '—'} frames/s · ${latency} ms inference`}
      tone="normal" />
    {deliveryMs !== null && <Text style={{color: theme.secondary,
      fontSize: 13 * theme.scale}}>Frame delivery to app: {deliveryMs} ms</Text>}
    {corridor && <Text style={{color: theme.secondary, fontSize: 13 * theme.scale}}>
      Surface model: {Math.round(corridor.latencyMs)} ms · sampled about every 3 seconds
    </Text>}
  </ScreenFrame>;
}

function corridorColor(zone: CorridorZone): string {
  if (zone.status === 'OBSTRUCTED') return '#D6454555';
  if (zone.status === 'POTENTIAL_GROUND') return '#168AAD55';
  return '#5F6B7355';
}

function zoneLabel(zone: CorridorZone): string {
  if (zone.status === 'OBSTRUCTED') return zone.obstacles.length ?
    `OBSTRUCTED: ${zone.obstacles.join(', ')}` : 'OBSTRUCTED';
  if (zone.status === 'POTENTIAL_GROUND') return 'POSSIBLE GROUND';
  if (zone.surface === 'ROAD') return 'ROAD / UNKNOWN';
  if (zone.surface === 'STAIRS') return 'STAIRS / UNKNOWN';
  if (zone.surface === 'VEGETATION') return 'VEGETATION / UNKNOWN';
  if (zone.surface === 'POOR_VISIBILITY') return 'LOW VISIBILITY';
  return 'UNKNOWN';
}

function titleCase(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase();
}
