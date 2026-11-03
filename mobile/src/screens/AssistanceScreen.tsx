import React from 'react';
import {Text, View, type ViewStyle} from 'react-native';
import {CameraView} from '../CameraView';
import {ActionButton, ScreenFrame, Section, StatusRow, type Theme} from '../ui/design';

export function AssistanceScreen({theme, style, assisting, cameraReady, paused, lastCue,
  lastReading, sceneSummary, approachNote, fps, latency, deliveryMs, error,
  onStart, onPause, onStop, onRepeat, onDescribe, onVoice, onEndVoice, listening}: {
  theme: Theme; style?: ViewStyle; assisting: boolean; cameraReady: boolean; paused: boolean;
  lastCue: string; lastReading: string; sceneSummary: string; approachNote: string;
  fps: number | null; latency: number | null; deliveryMs: number | null; error: string;
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
  </ScreenFrame>;
}
