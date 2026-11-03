import React from 'react';
import {Text, View} from 'react-native';
import {RouteMap} from '../RouteMap';
import type {Place} from '../mapsApi';
import type {Point} from '../navigation';
import {ActionButton, ScreenFrame, Section, StatusRow, type Theme} from '../ui/design';

export function NavigationScreen({theme, destination, places, position, route, stepCount,
  currentStep, instruction, navigating, guidancePaused, gpsState, error, status, transcript,
  listening, onVoice, onEndVoice, onConfirm, onStart, onPause, onRepeat, onStop, onRefresh}: {
  theme: Theme; destination: Place | null; places: Place[]; position: Point | null;
  route: Point[]; stepCount: number; currentStep: number; instruction: string;
  navigating: boolean; guidancePaused: boolean; gpsState: string; error: string; status: string;
  transcript: string; listening: boolean;
  onVoice: () => void; onEndVoice: () => void; onConfirm: (place: Place) => void; onStart: () => void;
  onPause: () => void; onRepeat: () => void; onStop: () => void; onRefresh: () => void;
}) {
  const routeReady = stepCount > 0;
  return <ScreenFrame title="Walking guidance" theme={theme}
    description="Speak a destination, confirm the place, then start guidance.">
    <View style={{padding: 20, borderRadius: 20, borderWidth: 2, borderColor: theme.border,
      backgroundColor: theme.surface, gap: 10}}>
      <Text style={{color: theme.accentInk, fontSize: 13 * theme.scale,
        fontWeight: '900'}}>NEXT INSTRUCTION</Text>
      <Text style={{color: theme.text, fontSize: 27 * theme.scale,
        lineHeight: 35 * theme.scale, fontWeight: '900'}}>
        {navigating ? instruction || 'Preparing the next instruction' :
          routeReady ? 'Route ready to start' : 'No route selected'}
      </Text>
      {!!destination && <Text style={{color: theme.secondary, fontSize: 16 * theme.scale,
        lineHeight: 23 * theme.scale}}>To {destination.name}</Text>}
      {navigating && <Text style={{color: theme.accentInk, fontSize: 14 * theme.scale,
        fontWeight: '800'}}>Instruction {Math.min(currentStep + 1, stepCount)} of {stepCount}
        {guidancePaused ? ' · Paused' : ''}</Text>}
    </View>

    <StatusRow label="GPS" value={gpsState} theme={theme}
      tone={gpsState.startsWith('Last fix') ? 'positive' : 'warning'} />
    {!!error && <Text accessibilityRole="alert" style={{color: theme.danger,
      fontSize: 16 * theme.scale, lineHeight: 23 * theme.scale}}>{error}</Text>}
    <Text style={{color: theme.secondary, fontSize: 15 * theme.scale,
      lineHeight: 22 * theme.scale}}>{status}</Text>

    <Section title="Find a destination" theme={theme}>
      <ActionButton label={listening ? 'Listening for a destination or command' :
        'Speak a destination or command'} theme={theme} primary
        hint="Say go to followed by a place and city" onPress={onVoice} disabled={listening} />
      {listening && <ActionButton label="End voice session" theme={theme} onPress={onEndVoice} />}
      {!!transcript && <Text style={{color: theme.secondary,
        fontSize: 14 * theme.scale}}>Last heard: {transcript}</Text>}
      <Text style={{color: theme.secondary, fontSize: 14 * theme.scale,
        lineHeight: 21 * theme.scale}}>For example: “Go to Heritage Street Amritsar.”
        Wake NAVI again before confirming a result.</Text>
    </Section>

    {!!places.length && <Section title="Confirm the right place" theme={theme}>
      {places.map((place, index) => <ActionButton key={place.id} theme={theme}
        label={`${index + 1}. ${place.name}. ${place.address}`}
        hint={`Create a walking route to option ${index + 1}`}
        onPress={() => onConfirm(place)} />)}
    </Section>}

    <Section title="Guidance controls" theme={theme}>
      {routeReady && !navigating && <ActionButton label="Start walking guidance" theme={theme}
        onPress={onStart} />}
      {navigating && <ActionButton label={guidancePaused ? 'Resume walking guidance' : 'Pause walking guidance'}
        theme={theme} onPress={onPause} />}
      <ActionButton label="Repeat next instruction" theme={theme} onPress={onRepeat}
        disabled={!instruction} />
      <ActionButton label="Refresh GPS" theme={theme} onPress={onRefresh} />
      {(navigating || routeReady) && <ActionButton label="Stop walking guidance" theme={theme}
        danger onPress={onStop} />}
    </Section>

    <Section title="Route map" theme={theme}>
      <Text style={{color: theme.secondary, fontSize: 14 * theme.scale,
        lineHeight: 21 * theme.scale}}>Visual reference only. Turn instructions remain available by voice.</Text>
      <View importantForAccessibility="no-hide-descendants"
        style={{height: 250, borderWidth: 2, borderColor: theme.border,
        borderRadius: 18, overflow: 'hidden', backgroundColor: theme.surface}}>
        <RouteMap position={position} destination={destination?.point || null} route={route} />
      </View>
      <Text style={{color: theme.secondary, fontSize: 13 * theme.scale,
        lineHeight: 19 * theme.scale}}>Live map tiles and route search require internet.
        NAVI cannot verify safe crossings or accessible paths.</Text>
    </Section>
  </ScreenFrame>;
}
