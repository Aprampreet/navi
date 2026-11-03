import React from 'react';
import {Text, View} from 'react-native';
import {ActionButton, ScreenFrame, Section, StatusRow, type Appearance, type Theme} from '../ui/design';

export type Verbosity = 'focused' | 'all';

export function SettingsScreen({theme, appearance, speechRate, verbosity, hapticsEnabled, highContrast,
  largeText, voiceActivation, voiceState, offlineVoice, cameraPermission,
  microphonePermission, locationPermission, onSpeechRate, onVerbosity, onHaptics,
  onAppearance, onContrast, onLargeText, onVoiceActivation, onCheckPermissions}: {
  theme: Theme; appearance: Appearance; speechRate: number; verbosity: Verbosity; hapticsEnabled: boolean;
  highContrast: boolean; largeText: boolean; voiceActivation: boolean;
  voiceState: string; offlineVoice: string; cameraPermission: string;
  microphonePermission: string; locationPermission: string;
  onSpeechRate: (rate: number) => void; onVerbosity: (value: Verbosity) => void;
  onHaptics: () => void; onAppearance: (value: Appearance) => void;
  onContrast: () => void; onLargeText: () => void;
  onVoiceActivation: () => void; onCheckPermissions: () => void;
}) {
  return <ScreenFrame title="Settings" description="Make NAVI easier to hear, feel, and read."
    theme={theme}>
    <Section title="Speech" theme={theme}>
      <Text style={{color: theme.secondary, fontSize: 15 * theme.scale}}>
        Speech rate: {speechRate.toFixed(2)}×</Text>
      <View style={{gap: 9}}>
        {[0.85, 1, 1.15].map(rate => <ActionButton key={rate} theme={theme}
          label={`${rate.toFixed(2)}× speech${rate === speechRate ? ' · selected' : ''}`}
          selected={rate === speechRate} onPress={() => onSpeechRate(rate)} />)}
      </View>
      <ActionButton theme={theme}
        label={verbosity === 'focused' ? 'Spoken scene detail: Focused' : 'Spoken scene detail: All changes'}
        hint="Focused speaks centre changes while retaining text and route instructions"
        onPress={() => onVerbosity(verbosity === 'focused' ? 'all' : 'focused')} />
    </Section>

    <Section title="Touch and vision" theme={theme}>
      <Text style={{color: theme.secondary, fontSize: 15 * theme.scale}}>
        Appearance preset</Text>
      <View style={{flexDirection: 'row', gap: 10}}>
        <View style={{flex: 1}}><ActionButton theme={theme} label="Dark appearance"
          selected={appearance === 'dark' && !highContrast}
          onPress={() => onAppearance('dark')} /></View>
        <View style={{flex: 1}}><ActionButton theme={theme} label="Light appearance"
          selected={appearance === 'light' && !highContrast}
          onPress={() => onAppearance('light')} /></View>
      </View>
      <ActionButton theme={theme} label={`Haptic feedback ${hapticsEnabled ? 'on' : 'off'}`}
        selected={hapticsEnabled} onPress={onHaptics} />
      <ActionButton theme={theme} label={`High contrast ${highContrast ? 'on' : 'off'}`}
        selected={highContrast} onPress={onContrast}
        hint="Use the black, white and yellow contrast preset" />
      <ActionButton theme={theme} label={`Larger text ${largeText ? 'on' : 'off'}`}
        selected={largeText} onPress={onLargeText} />
      <Text style={{color: theme.secondary, fontSize: 14 * theme.scale,
        lineHeight: 21 * theme.scale}}>Android system font scaling also applies.
        NAVI uses no essential gesture-only controls.</Text>
    </Section>

    <Section title="Voice and offline resources" theme={theme}>
      <ActionButton theme={theme}
        label={`Hands-free “Hi NAVI” ${voiceActivation ? 'on' : 'off'}`}
        selected={voiceActivation} onPress={onVoiceActivation}
        hint="Turn background wake listening on or off while NAVI is open" />
      <StatusRow theme={theme} label="Wake listening" value={voiceState}
        tone={voiceState.includes('Ready') ? 'positive' : 'warning'} />
      <StatusRow theme={theme} label="Offline speech voice" value={offlineVoice}
        tone={offlineVoice === 'Installed' ? 'positive' : 'warning'} />
      <StatusRow theme={theme} label="Offline OCR" value="Bundled in app" tone="positive" />
      <StatusRow theme={theme} label="Object model" value="Checked when camera starts" />
      <Text style={{color: theme.secondary, fontSize: 14 * theme.scale,
        lineHeight: 21 * theme.scale}}>The wake phrase is experimental. Tap “Speak a command”
        on Home or Navigation if it misses you.</Text>
    </Section>

    <Section title="Permissions" theme={theme}>
      <StatusRow theme={theme} label="Camera" value={cameraPermission} />
      <StatusRow theme={theme} label="Microphone" value={microphonePermission} />
      <StatusRow theme={theme} label="Precise location" value={locationPermission} />
      <ActionButton theme={theme} label="Check permissions and GPS" onPress={onCheckPermissions}
        hint="Refresh permission status and request a GPS fix if location is allowed" />
    </Section>

    <Section title="Privacy and safety" theme={theme}>
      <Text style={{color: theme.secondary, fontSize: 15 * theme.scale,
        lineHeight: 23 * theme.scale}}>Camera detection, OCR, and voice recognition run on this phone.
        Place search, route requests, and live map tiles need a network connection.
        NAVI does not verify safe crossings, accessible routes, or obstacle distance.</Text>
    </Section>
  </ScreenFrame>;
}
