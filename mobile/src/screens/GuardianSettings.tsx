import React, {useEffect, useState} from 'react';
import {Text, TextInput, View} from 'react-native';
import {ActionButton, Section, StatusRow, type Theme} from '../ui/design';
import type {GuardianSensitivity, GuardianState} from '../guardian';

export function GuardianSettings({theme, guardian, onSave, onTest}: {
  theme: Theme; guardian: GuardianState;
  onSave: (name: string, phone: string, confirmation: string,
    enabled: boolean, sensitivity: GuardianSensitivity, seconds: number) => void;
  onTest: () => void;
}) {
  const [name, setName] = useState(guardian.name);
  const [phone, setPhone] = useState(guardian.phone);
  const [confirmation, setConfirmation] = useState(guardian.phone);
  const [enabled, setEnabled] = useState(guardian.enabled);
  const [sensitivity, setSensitivity] = useState<GuardianSensitivity>(guardian.sensitivity);
  const [seconds, setSeconds] = useState(guardian.seconds);
  useEffect(() => { setName(guardian.name); setPhone(guardian.phone); setConfirmation(guardian.phone);
    setEnabled(guardian.enabled); setSensitivity(guardian.sensitivity); setSeconds(guardian.seconds); },
  [guardian.name, guardian.phone, guardian.enabled, guardian.sensitivity, guardian.seconds]);
  const field = {minHeight: 58, borderWidth: 2, borderRadius: 14, borderColor: theme.border,
    backgroundColor: theme.surface, color: theme.text, paddingHorizontal: 16,
    fontSize: 18 * theme.scale};
  return <Section title="Guardian emergency SOS" theme={theme}>
    <Text style={{color: theme.secondary, fontSize: 15 * theme.scale, lineHeight: 23 * theme.scale}}>
      Set a consenting contact. A deliberate shake or the SOS button starts a cancellable countdown.
      Shake monitoring works only while NAVI is open. Cellular SMS needs service; delivery may remain unconfirmed.
    </Text>
    <TextInput accessibilityLabel="Emergency contact name" placeholder="Contact name"
      placeholderTextColor={theme.secondary} value={name} onChangeText={setName}
      autoCapitalize="words" style={field} />
    <TextInput accessibilityLabel="Emergency contact phone number" placeholder="Phone number"
      placeholderTextColor={theme.secondary} value={phone} onChangeText={setPhone}
      keyboardType="phone-pad" style={field} />
    <TextInput accessibilityLabel="Confirm emergency contact phone number"
      placeholder="Enter phone number again" placeholderTextColor={theme.secondary}
      value={confirmation} onChangeText={setConfirmation} keyboardType="phone-pad" style={field} />
    <ActionButton theme={theme} label={`Shake to SOS ${enabled ? 'on' : 'off'}`}
      selected={enabled} onPress={() => setEnabled(!enabled)}
      hint="Enable deliberate multi-shake detection while NAVI is open" />
    <Text style={{color: theme.text, fontSize: 16 * theme.scale, fontWeight: '800'}}>
      Shake sensitivity</Text>
    {(['low', 'normal', 'high'] as const).map(value => <ActionButton key={value}
      theme={theme} label={`${value} sensitivity`}
      selected={sensitivity === value} onPress={() => setSensitivity(value)} />)}
    <Text style={{color: theme.text, fontSize: 16 * theme.scale, fontWeight: '800'}}>
      Cancellation countdown</Text>
    <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8}}>
      {[5, 10, 15, 20, 30].map(value => <View key={value} style={{minWidth: 92, flexGrow: 1}}>
        <ActionButton theme={theme} label={`${value} seconds`} selected={seconds === value}
          onPress={() => setSeconds(value)} /></View>)}
    </View>
    <ActionButton theme={theme} primary label="Save and confirm Guardian contact"
      hint="Save only when both phone number entries match"
      onPress={() => onSave(name, phone, confirmation, enabled, sensitivity, seconds)} />
    <ActionButton theme={theme} label="Open test SMS draft" onPress={onTest}
      disabled={!guardian.phone}
      hint="Creates a clearly labelled test draft; you must tap Send in the messaging app" />
    <StatusRow theme={theme} label="Shake monitor" value={!guardian.accelerometerAvailable ?
      'Accelerometer unavailable' : !guardian.enabled ? 'Disabled in Guardian settings' :
        guardian.monitoring ? 'Active while NAVI is open' : 'Enabled; waiting for NAVI foreground'} />
    <StatusRow theme={theme} label="Automatic SMS permission"
      value={guardian.smsPermission ? 'Granted' : 'Unavailable; composer fallback'} />
    <StatusRow theme={theme} label="Latest SOS state" value={guardian.phase} />
    {!!guardian.detail && <Text accessibilityRole="alert" style={{color: theme.text,
      fontSize: 15 * theme.scale, lineHeight: 23 * theme.scale}}>{guardian.detail}</Text>}
    {guardian.history.length > 0 && <View style={{gap: 8}}>
      <Text accessibilityRole="header" style={{color: theme.text, fontSize: 17 * theme.scale,
        fontWeight: '800'}}>Previous attempts</Text>
      {guardian.history.map((attempt, index) => <Text key={`${attempt.timestamp}-${index}`}
        style={{color: theme.secondary, fontSize: 14 * theme.scale, lineHeight: 21 * theme.scale}}>
        {new Date(attempt.timestamp).toLocaleString()}: {attempt.status}. {attempt.detail}
      </Text>)}
    </View>}
  </Section>;
}
