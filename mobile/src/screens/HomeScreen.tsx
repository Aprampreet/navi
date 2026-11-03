import React from 'react';
import {Text, View} from 'react-native';
import {ActionButton, ScreenFrame, Section, StatusRow, type Theme} from '../ui/design';

export function HomeScreen({theme, assisting, cameraReady, navigating, voiceState, gpsState,
  offlineVoice, lastAnnouncement, transcript, listening, error, onAssistance, onNavigate, onDescribe,
  onRepeat, onSettings, onVoice, onEndVoice}: {
  theme: Theme; assisting: boolean; cameraReady: boolean; navigating: boolean;
  voiceState: string; gpsState: string; offlineVoice: string; lastAnnouncement: string;
  transcript: string; listening: boolean;
  error: string; onAssistance: () => void; onNavigate: () => void; onDescribe: () => void;
  onRepeat: () => void; onSettings: () => void; onVoice: () => void; onEndVoice: () => void;
}) {
  const state = navigating ? 'Walking guidance active' : cameraReady ? 'Camera assistance active' :
    assisting ? 'Camera starting' : 'Ready when you are';
  return <ScreenFrame title="NAVI" description="Your surroundings, spoken clearly." theme={theme}>
    <View style={{padding: 20, borderRadius: 22, borderWidth: 2, borderColor: theme.border,
      backgroundColor: theme.surface, gap: 10}}>
      <Text style={{color: theme.accentInk, fontSize: 13 * theme.scale, fontWeight: '900',
        letterSpacing: 1}}>ASSISTANT STATUS</Text>
      <Text style={{color: theme.text, fontSize: 26 * theme.scale, lineHeight: 33 * theme.scale,
        fontWeight: '900'}}>{state}</Text>
      <Text style={{color: theme.secondary, fontSize: 15 * theme.scale,
        lineHeight: 22 * theme.scale}}>Say “Hi NAVI” for one voice command, then wake NAVI again for the next.</Text>
    </View>

    <ActionButton theme={theme} primary
      label={assisting ? 'Continue assistance' : 'Start assistance'}
      hint={assisting ? 'Open the live assistance screen' : 'Start the camera and spoken scene alerts'}
      onPress={onAssistance} />

    {!!error && <View accessible accessibilityRole="alert" style={{padding: 16,
      borderWidth: 2, borderColor: theme.danger, borderRadius: 16}}>
      <Text style={{color: theme.danger, fontSize: 16 * theme.scale, lineHeight: 23 * theme.scale}}>
        {error}
      </Text>
    </View>}

    <Section title="At a glance" theme={theme}>
      <StatusRow label="Voice listening" value={voiceState} theme={theme}
        tone={voiceState.includes('Ready') ? 'positive' : 'warning'} />
      <StatusRow label="Camera" value={cameraReady ? 'Detecting' : assisting ? 'Starting' : 'Off'}
        theme={theme} tone={cameraReady ? 'positive' : 'normal'} />
      <StatusRow label="GPS" value={gpsState} theme={theme}
        tone={gpsState.startsWith('Last fix') ? 'positive' : 'warning'} />
      <StatusRow label="Offline speech" value={offlineVoice} theme={theme}
        tone={offlineVoice === 'Installed' ? 'positive' : 'warning'} />
    </Section>

    <Section title="Quick actions" theme={theme}>
      <ActionButton label="Navigate" hint="Find and confirm a walking destination" theme={theme}
        onPress={onNavigate} />
      <ActionButton label="Describe surroundings" hint="Speak the current stable camera scene" theme={theme}
        onPress={onDescribe} />
      <ActionButton label="Repeat last announcement" hint="Replay the last meaningful spoken cue"
        theme={theme} onPress={onRepeat} disabled={!lastAnnouncement} />
      <ActionButton label={listening ? 'Listening for a command' : 'Speak a command'}
        hint="Listen once without saying Hi NAVI" theme={theme}
        onPress={onVoice} disabled={listening} />
      {listening && <ActionButton label="End voice session" theme={theme} onPress={onEndVoice} />}
      <ActionButton label="Settings and accessibility" theme={theme} onPress={onSettings} />
    </Section>

    {!!lastAnnouncement && <Section title="Last announcement" theme={theme}>
      <Text style={{color: theme.text, fontSize: 17 * theme.scale,
        lineHeight: 25 * theme.scale}}>{lastAnnouncement}</Text>
    </Section>}
    {!!transcript && <Text style={{color: theme.secondary, fontSize: 14 * theme.scale,
      lineHeight: 21 * theme.scale}}>Last heard: {transcript}</Text>}
  </ScreenFrame>;
}
