import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {AppState, NativeEventEmitter, NativeModules, PermissionsAndroid, Pressable,
  ScrollView, StyleSheet, Text, View} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {SafeAreaProvider, useSafeAreaInsets} from 'react-native-safe-area-context';
import {AlertManager} from './src/alerts';
import {ApproachEstimator} from './src/approach';
import {CameraView} from './src/CameraView';
import {RouteMap} from './src/RouteMap';
import {describeScene, SceneTracker, type Detection} from './src/detections';
import {movementCues, ObjectTracker} from './src/tracking';
import {parseCommand, formatInstruction, shouldAdvanceStep, distanceMeters, type Point, type RouteStep} from './src/navigation';
import {searchPlaces, walkingRoute, type Place} from './src/mapsApi';

const Native = NativeModules.NaviNative;
type Fix = Point & {accuracy: number};
type Frame = {detections: Detection[]; timestamp: number; latencyMs: number};

type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger';
function Button({label, onPress, disabled = false, variant = 'secondary', compact = false}: {
  label: string; onPress: () => void; disabled?: boolean;
  variant?: ButtonVariant; compact?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled}
    onPress={onPress} style={({pressed}) => [styles.button,
      variant === 'primary' && styles.buttonPrimary,
      variant === 'quiet' && styles.buttonQuiet,
      variant === 'danger' && styles.buttonDanger,
      compact && styles.buttonCompact,
      disabled && styles.disabled,
      pressed && !disabled && styles.pressed]}>
    <Text style={[styles.buttonText, variant === 'primary' && styles.buttonTextPrimary,
      variant === 'danger' && styles.buttonTextDanger,
      compact && styles.buttonTextCompact]}>{label}</Text>
  </Pressable>;
}

function NaviApp() {
  const insets = useSafeAreaInsets();
  const [assisting, setAssisting] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const cameraReadyRef = useRef(false);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [prefsReady, setPrefsReady] = useState(false);
  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState('Ready. Camera must face forward and remain uncovered.');
  const [error, setError] = useState('');
  const [fix, setFix] = useState<Fix | null>(null);
  const [places, setPlaces] = useState<Place[]>([]);
  const [selected, setSelected] = useState<Place | null>(null);
  const [points, setPoints] = useState<Point[]>([]);
  const [steps, setSteps] = useState<RouteStep[]>([]);
  const [navigating, setNavigating] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [lastInstruction, setLastInstruction] = useState('');
  const [latency, setLatency] = useState<number | null>(null);
  const [fps, setFps] = useState<number | null>(null);
  const [deliveryMs, setDeliveryMs] = useState<number | null>(null);
  const [lastCue, setLastCue] = useState('');
  const [sceneSummary, setSceneSummary] = useState('');
  const [approachNote, setApproachNote] = useState('');
  const stepIndex = useRef(0);
  const approachingStep = useRef(-1);
  const performanceWindow = useRef({since: 0, frames: 0, inferenceTotal: 0, deliveryTotal: 0});
  const sceneTracker = useRef(new SceneTracker());
  const objectTracker = useRef(new ObjectTracker());
  const approachEstimator = useRef(new ApproachEstimator());
  const alerts = useMemo(() => new AlertManager((text) => Native.speak(text)), []);
  alerts.muted = muted || listening; alerts.paused = paused;

  useEffect(() => {
    AsyncStorage.getItem('navi.muted').then(value => {
      setMuted(value === 'true'); setPrefsReady(true);
    }).catch(() => setPrefsReady(true));
  }, []);
  useEffect(() => {
    if (prefsReady) AsyncStorage.setItem('navi.muted', String(muted)).catch(() => {});
  }, [muted, prefsReady]);

  useEffect(() => {
    const emitter = new NativeEventEmitter(Native);
    const detections = emitter.addListener('NaviDetections', (event: Object) => {
      const frame = event as Frame;
      const receivedAt = Date.now();
      const window = performanceWindow.current;
      if (!window.since) window.since = receivedAt;
      window.frames++;
      window.inferenceTotal += Number.isFinite(frame.latencyMs) ? frame.latencyMs : 0;
      window.deliveryTotal += Number.isFinite(frame.timestamp) ?
        Math.max(0, receivedAt - frame.timestamp) : 0;
      if (receivedAt - window.since >= 5000) {
        setFps(Math.round(window.frames * 10000 / (receivedAt - window.since)) / 10);
        setLatency(Math.round(window.inferenceTotal / window.frames));
        setDeliveryMs(Math.round(window.deliveryTotal / window.frames));
        performanceWindow.current = {since: receivedAt, frames: 0, inferenceTotal: 0, deliveryTotal: 0};
      }
      const tracked = objectTracker.current.update(
        Array.isArray(frame.detections) ? frame.detections : [],
        Number.isFinite(frame.timestamp) ? frame.timestamp : Date.now());
      for (const movement of tracked.movements) {
        console.info(`NAVI track ${movement.id}: ${movement.label} ${movement.from} to ` +
          `${movement.to} in camera view`);
      }
      const scene = sceneTracker.current.update(tracked.objects.map(object => object.box));
      const approach = approachEstimator.current.update(tracked);
      setSceneSummary(describeScene(scene.counts));
      setApproachNote(approach.observations.some(observation => observation.zone === 'centre' &&
        observation.state === 'UNKNOWN' && observation.logScaleChange !== null &&
        Math.abs(observation.logScaleChange) >= 0.18) ?
        'Apparent distance uncertain' : '');
      if (!scene.hasStableObjects) setLastCue('');
      const seen = new Set<string>();
      let displayed = false;
      for (const change of [...movementCues(tracked.movements), ...scene.events, ...approach.events]) {
        if (seen.has(change.key)) continue;
        seen.add(change.key);
        const queued = alerts.enqueue(change.text, change.priority, change.key, Date.now(), 'camera');
        if (queued || !displayed) { setLastCue(change.text); displayed = true; }
      }
    });
    const cameraError = emitter.addListener('NaviCameraError', (event: Object) => {
      setError(`Camera or model unavailable: ${(event as {message: string}).message}`);
      setStatus('Camera unavailable'); cameraReadyRef.current = false; setCameraReady(false); setAssisting(false);
      setNavigating(false); setSceneSummary(''); setApproachNote(''); setLastCue('');
      setLatency(null); setFps(null); setDeliveryMs(null);
      performanceWindow.current = {since: 0, frames: 0, inferenceTotal: 0, deliveryTotal: 0};
      sceneTracker.current.reset(); objectTracker.current.reset(); approachEstimator.current.reset();
      alerts.clear(); Native.stopSpeech();
      alerts.enqueue('Camera assistance stopped. Check the camera before continuing.',
        5, 'camera-error', Date.now(), 'system');
    });
    const cameraStarted = emitter.addListener('NaviCameraReady', () => {
      if (cameraReadyRef.current) return;
      cameraReadyRef.current = true;
      setCameraReady(true);
      setStatus('Detecting objects in the camera view');
      alerts.enqueue('Assistance started. Camera detection is active.', 2, 'assistance-start');
    });
    const appState = AppState.addEventListener('change', state => {
      if (state === 'background') {
        cameraReadyRef.current = false; setCameraReady(false); setAssisting(false); setNavigating(false);
        setSceneSummary(''); setApproachNote(''); setLastCue('');
        setLatency(null); setFps(null); setDeliveryMs(null);
        performanceWindow.current = {since: 0, frames: 0, inferenceTotal: 0, deliveryTotal: 0};
        sceneTracker.current.reset(); objectTracker.current.reset(); approachEstimator.current.reset();
        alerts.clear(); Native.stopSpeech();
      }
    });
    return () => { detections.remove(); cameraError.remove(); cameraStarted.remove(); appState.remove(); };
  }, [alerts]);

  async function request(permission: string): Promise<boolean> {
    return (await PermissionsAndroid.request(permission as any)) === PermissionsAndroid.RESULTS.GRANTED;
  }
  async function refreshLocation(): Promise<Fix | null> {
    if (!await request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION)) {
      setError('Precise location permission denied. Map routing needs GPS.'); return null;
    }
    try { const location = await Native.getLocation() as Fix; setFix(location); return location; }
    catch (e) { setError(`GPS unavailable: ${String(e)}`); return null; }
  }
  async function startAssistance(): Promise<boolean> {
    setError('');
    if (!await request(PermissionsAndroid.PERMISSIONS.CAMERA)) {
      setError('Camera permission denied. Object detection is unavailable.'); return false;
    }
    cameraReadyRef.current = false; setCameraReady(false); setLatency(null); setFps(null);
    setDeliveryMs(null); setLastCue('');
    performanceWindow.current = {since: 0, frames: 0, inferenceTotal: 0, deliveryTotal: 0};
    setSceneSummary(''); setApproachNote('');
    sceneTracker.current.reset(); objectTracker.current.reset(); approachEstimator.current.reset();
    alerts.clearCamera();
    setAssisting(true); setPaused(false); alerts.paused = false; setStatus('Starting camera preview…');
    void refreshLocation();
    return true;
  }
  function stop() {
    cameraReadyRef.current = false; setCameraReady(false); setLatency(null); setFps(null);
    setDeliveryMs(null); performanceWindow.current = {since: 0, frames: 0,
      inferenceTotal: 0, deliveryTotal: 0};
    setAssisting(false); setNavigating(false); setPaused(false); setPoints([]);
    setSteps([]); setPlaces([]); setSelected(null); stepIndex.current = 0; approachingStep.current = -1;
    setLastInstruction(''); setTranscript(''); setLastCue(''); setSceneSummary(''); setApproachNote('');
    sceneTracker.current.reset(); objectTracker.current.reset(); approachEstimator.current.reset();
    alerts.clear(); Native.stopSpeech(); setStatus('Navigation stopped');
    alerts.enqueue('Navigation stopped.', 2, 'navigation-stop');
  }
  async function listen() {
    setError('');
    if (!await request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO)) {
      setError('Microphone permission denied.'); return;
    }
    alerts.muted = true;
    alerts.clear();
    await Native.stopSpeech();
    setListening(true); setStatus('Listening');
    try {
      const text: string = await Native.listen(); setTranscript(text);
      setListening(false); alerts.muted = muted;
      const command = parseCommand(text);
      if (command.type === 'stop') stop();
      else if (command.type === 'repeat') repeat();
      else if (command.type === 'pause') {
        alerts.paused = true; alerts.clearCamera(); setPaused(true); setStatus('Obstacle alerts paused');
      }
      else if (command.type === 'destination') {
        const location = fix || await refreshLocation(); if (!location) return;
        setNavigating(false); setPoints([]); setSteps([]); setSelected(null);
        setLastInstruction(''); stepIndex.current = 0; approachingStep.current = -1;
        setStatus(`Searching for ${command.destination}`);
        const results = await searchPlaces(command.destination, location);
        setPlaces(results);
        if (!results.length) throw new Error('No matching destination found');
        setStatus('Destination found. Choose and confirm a place.');
        alerts.enqueue(`${results[0].name} found. Please confirm the destination.`, 2, 'place');
      } else {
        setStatus('Awaiting destination command');
        setError('Command not understood. Try “Navigate to” followed by a destination.');
      }
    } catch (e) { setStatus('Error'); setError(`Speech or search failed: ${String(e)}`); }
    finally { alerts.muted = muted; setListening(false); }
  }
  async function confirm(place: Place) {
    const origin = await refreshLocation(); if (!origin) return;
    try {
      setError(''); setSelected(place); setStatus(`Loading walking route to ${place.name}`);
      const route = await walkingRoute(origin, place.point);
      setPoints(route.points); setSteps(route.steps); stepIndex.current = 0; approachingStep.current = -1;
      setStatus('Route ready. Start navigation when ready.');
      alerts.enqueue(`Route ready to ${place.name}. Start navigation when ready.`, 2, 'route-ready');
    } catch (e) { setError(`Walking route unavailable: ${String(e)}`); }
  }
  const announceStep = useCallback((step: RouteStep) => {
    const instruction = formatInstruction(step.instruction);
    setLastInstruction(instruction);
    alerts.enqueue(instruction, 4, `step-${stepIndex.current}`, Date.now(), 'navigation');
  }, [alerts]);
  async function startNavigation() {
    if (!steps.length) { setError('No route steps available.'); return; }
    if (!assisting && !await startAssistance()) return;
    setNavigating(true); setStatus('Navigating and detecting'); announceStep(steps[0]);
  }
  function repeat() {
    if (lastInstruction) alerts.enqueue(lastInstruction, 4, `repeat-${Date.now()}`, Date.now(), 'navigation');
  }

  useEffect(() => {
    if (!navigating) return;
    const timer = setInterval(async () => {
      try {
        const location = await Native.getLocation() as Fix; setFix(location);
        const nextIndex = stepIndex.current + 1;
        const next = steps[nextIndex];
        if (next && shouldAdvanceStep(location, next, location.accuracy)) {
          stepIndex.current += 1; announceStep(next);
          if (stepIndex.current === steps.length - 1) {
            setNavigating(false); setStatus('Destination reached. Confirm your surroundings.');
          }
        } else if (next && location.accuracy <= 35 && approachingStep.current !== nextIndex) {
          const distance = distanceMeters(location, next.point);
          if (distance <= 65 && distance > Math.max(18, location.accuracy)) {
            approachingStep.current = nextIndex;
            alerts.enqueue(`In about ${Math.round(distance / 10) * 10} metres, ${formatInstruction(next.instruction)}`,
              4, `approach-${nextIndex}`, Date.now(), 'navigation');
          }
        } else if (location.accuracy > 35) setStatus('GPS accuracy is poor. Check surroundings.');
      } catch { setStatus('GPS unavailable. Guidance paused until location returns.'); }
    }, 5000);
    return () => clearInterval(timer);
  }, [navigating, steps, announceStep, alerts]);

  const stateLabel = navigating ? 'GUIDING' : cameraReady ? 'ASSISTING' : 'READY';
  const heroTitle = navigating && lastInstruction ? lastInstruction :
    selected ? `To ${selected.name}` : 'Find your way.';

  return <ScrollView style={styles.root} contentContainerStyle={[styles.content,
    {paddingTop: insets.top + 14, paddingBottom: insets.bottom + 32}]}>
    <View style={styles.masthead}>
      <View>
        <Text style={styles.wordmark} accessibilityRole="header">navi<Text style={styles.wordmarkDot}>.</Text></Text>
        <Text style={styles.tagline}>WALK WITH AWARENESS</Text>
      </View>
      <View style={styles.statePill}>
        <View style={[styles.stateDot, navigating && styles.stateDotActive]} />
        <Text style={styles.statePillText}>{stateLabel}</Text>
      </View>
    </View>

    <View style={styles.hero}>
      <Text style={styles.eyebrow}>{navigating ? 'NEXT INSTRUCTION' : selected ? 'YOUR DESTINATION' : 'START HERE'}</Text>
      <Text style={styles.heroTitle} accessibilityLiveRegion="polite">{heroTitle}</Text>
      <Text style={styles.status} accessibilityLiveRegion="polite">{status}</Text>
    </View>

    {!!error && <View style={styles.errorBox}>
      <Text style={styles.errorLabel}>NEEDS ATTENTION</Text>
      <Text style={styles.errorText} accessibilityLiveRegion="assertive">{error}</Text>
    </View>}

    <View style={styles.primaryActions}>
      <Button label={listening ? 'Listening…' : 'Speak Guidance  ↗'} onPress={listen}
        disabled={listening} variant="primary" />
      {!assisting && !navigating && <Button label="Start camera assistance" onPress={startAssistance} />}
      {!!steps.length && !navigating && <Button label="Start walking guidance  →" onPress={startNavigation} />}
      {navigating && <Button label="Repeat instruction" onPress={repeat} variant="quiet" />}
    </View>

    {!!transcript && <View style={styles.transcriptBox}>
      <Text style={styles.smallLabel}>I HEARD</Text>
      <Text style={styles.transcript}>{transcript}</Text>
    </View>}

    {!!places.length && <View style={styles.destinations}>
      <Text style={styles.sectionTitle}>Choose your destination</Text>
      <Text style={styles.sectionHint}>Confirm the right place before guidance begins.</Text>
      {places.map((place, index) => <Pressable key={place.id} accessibilityRole="button"
        accessibilityLabel={`Confirm ${place.name}, ${place.address}`}
        onPress={() => confirm(place)} style={({pressed}) => [styles.placeRow, pressed && styles.pressed]}>
        <Text style={styles.placeNumber}>{String(index + 1).padStart(2, '0')}</Text>
        <View style={styles.placeCopy}>
          <Text style={styles.placeName}>{place.name}</Text>
          <Text style={styles.placeAddress}>{place.address}</Text>
        </View>
        <Text style={styles.placeArrow}>↗</Text>
      </Pressable>)}
    </View>}

    <View style={styles.sectionHeading}>
      <View>
        <Text style={styles.sectionKicker}>01 / ENVIRONMENT</Text>
        <Text style={styles.sectionTitle}>Live view</Text>
      </View>
      <Text style={styles.sectionMeta}>{assisting ? cameraReady ? 'LIVE' : 'STARTING' : 'OFF'}</Text>
    </View>
    <View style={styles.cameraShell}>
      {assisting && <CameraView active={assisting} style={styles.camera} />}
      <View style={[styles.cameraCaption, !assisting && styles.cameraCaptionInactive]}>
        <Text style={styles.cameraCaptionLabel}>{assisting ? 'CAMERA CUE' : 'CAMERA OFF'}</Text>
        <Text style={styles.cameraCue} accessibilityLiveRegion="polite">
          {lastCue || (assisting ? 'Looking for people and objects…' : 'Start assistance to hear object cues.')}
        </Text>
        {!!sceneSummary && <Text style={styles.sceneSummary}>IN VIEW · {sceneSummary}</Text>}
        {!!approachNote && <Text style={styles.approachNote}>{approachNote}</Text>}
        {latency !== null && <Text style={styles.latency}>
          {fps} fps · {latency} ms inference · {deliveryMs} ms to app
        </Text>}
      </View>
    </View>

    <View style={styles.sectionHeading}>
      <View>
        <Text style={styles.sectionKicker}>02 / ROUTE</Text>
        <Text style={styles.sectionTitle}>Your map</Text>
      </View>
      <Text style={styles.sectionMeta}>{points.length > 1 ? 'WALKING' : 'EXPLORE'}</Text>
    </View>
    <View style={styles.mapShell}>
      <RouteMap position={fix} destination={selected?.point || null} route={points} />
    </View>
    {!!selected && <Text style={styles.mapCaption}>Destination · {selected.name}</Text>}

    <View style={styles.toolsHeading}>
      <Text style={styles.sectionKicker}>QUICK CONTROLS</Text>
      <Text style={styles.sectionTitle}>Make it yours</Text>
    </View>
    <View style={styles.toolRow}>
      <View style={styles.toolHalf}><Button label={paused ? 'Resume alerts' : 'Pause alerts'}
        onPress={() => {
          const next = !paused; alerts.paused = next;
          if (next) alerts.clearCamera();
          setPaused(next);
        }} variant="quiet" compact /></View>
      <View style={styles.toolHalf}><Button label={muted ? 'Unmute voice' : 'Mute voice'}
        onPress={() => {
          const next = !muted; alerts.muted = next; setMuted(next);
          if (next) { alerts.clear(); Native.stopSpeech(); }
        }} variant="quiet" compact /></View>
    </View>
    <View style={styles.toolRow}>
      <View style={styles.toolHalf}><Button label="Refresh GPS" onPress={() => {void refreshLocation();}}
        variant="quiet" compact /></View>
      <View style={styles.toolHalf}><Button label="Repeat turn" onPress={repeat}
        disabled={!lastInstruction} variant="quiet" compact /></View>
    </View>
    {(assisting || navigating) && <Button label="Stop navigation and camera" onPress={stop} variant="danger" />}

    <View style={styles.safetyNote}>
      <Text style={styles.safetyTitle}>A note for every walk</Text>
      <Text style={styles.safetyText}>Use your cane, guide dog and judgment. NAVI cannot confirm safe crossings or clear paths. Camera detection runs on your phone; place search and routes need internet.</Text>
    </View>
  </ScrollView>;
}

export default function App() { return <SafeAreaProvider><NaviApp /></SafeAreaProvider>; }

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: '#F4F3EE'},
  content: {paddingHorizontal: 20},
  masthead: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24},
  wordmark: {fontSize: 43, fontWeight: '900', letterSpacing: -2.5, lineHeight: 48, color: '#142528'},
  wordmarkDot: {color: '#2F8175'},
  tagline: {fontSize: 10, letterSpacing: 2.3, fontWeight: '800', color: '#5B6D6B', marginTop: 1},
  statePill: {flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 11,
    paddingVertical: 9, borderRadius: 20, borderWidth: 1, borderColor: '#CFD8D1'},
  stateDot: {width: 7, height: 7, borderRadius: 4, backgroundColor: '#8B9A92'},
  stateDotActive: {backgroundColor: '#2F8175'},
  statePillText: {fontSize: 11, fontWeight: '800', letterSpacing: 1.2, color: '#294A47'},
  hero: {borderTopWidth: 1, borderColor: '#C7D0C9', paddingTop: 18, paddingBottom: 18},
  eyebrow: {fontSize: 11, fontWeight: '800', letterSpacing: 2, color: '#2F8175', marginBottom: 9},
  heroTitle: {fontSize: 34, lineHeight: 39, letterSpacing: -1.2, fontWeight: '800', color: '#142528'},
  status: {fontSize: 16, lineHeight: 22, color: '#526460', marginTop: 10},
  errorBox: {backgroundColor: '#FBE8E2', borderLeftWidth: 3, borderLeftColor: '#A64235',
    paddingHorizontal: 14, paddingVertical: 13, marginBottom: 14},
  errorLabel: {fontSize: 10, fontWeight: '800', letterSpacing: 1.7, color: '#8C352B', marginBottom: 5},
  errorText: {fontSize: 16, lineHeight: 22, color: '#67261F'},
  primaryActions: {gap: 9, marginBottom: 19},
  button: {minHeight: 57, borderRadius: 12, borderWidth: 1, borderColor: '#A9BBB1',
    backgroundColor: '#F4F3EE', alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 18, paddingVertical: 13},
  buttonPrimary: {backgroundColor: '#153B3B', borderColor: '#153B3B', minHeight: 68},
  buttonQuiet: {backgroundColor: '#E9EEE8', borderColor: '#E9EEE8'},
  buttonDanger: {backgroundColor: '#F4F3EE', borderColor: '#B87168', marginTop: 11},
  buttonCompact: {minHeight: 54, paddingHorizontal: 8},
  buttonText: {fontSize: 17, fontWeight: '800', color: '#173D3B', textAlign: 'center'},
  buttonTextPrimary: {color: '#FFFFFF', fontSize: 20},
  buttonTextDanger: {color: '#9B3F34'},
  buttonTextCompact: {fontSize: 15},
  pressed: {opacity: 0.78}, disabled: {opacity: 0.42},
  transcriptBox: {backgroundColor: '#E8ECE5', borderRadius: 12, padding: 14, marginBottom: 21},
  smallLabel: {fontSize: 10, fontWeight: '800', letterSpacing: 1.7, color: '#52716C'},
  transcript: {fontSize: 16, lineHeight: 22, color: '#213A38', marginTop: 5},
  destinations: {marginBottom: 24},
  sectionTitle: {fontSize: 24, lineHeight: 29, fontWeight: '800', letterSpacing: -0.6, color: '#142528'},
  sectionHint: {fontSize: 15, lineHeight: 20, color: '#65736F', marginTop: 4, marginBottom: 9},
  placeRow: {flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1,
    borderBottomColor: '#D1D9D1', paddingVertical: 15, minHeight: 64},
  placeNumber: {fontSize: 12, fontWeight: '800', color: '#2F8175', width: 24},
  placeCopy: {flex: 1}, placeName: {fontSize: 17, fontWeight: '800', color: '#142528'},
  placeAddress: {fontSize: 13, lineHeight: 18, color: '#63736E', marginTop: 3},
  placeArrow: {fontSize: 22, color: '#2F8175'},
  sectionHeading: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end',
    borderTopWidth: 1, borderColor: '#CBD4CD', paddingTop: 17, marginTop: 10, marginBottom: 12},
  sectionKicker: {fontSize: 10, fontWeight: '800', letterSpacing: 1.8, color: '#2F8175', marginBottom: 5},
  sectionMeta: {fontSize: 11, fontWeight: '800', letterSpacing: 1.2, color: '#426D65', marginBottom: 4},
  cameraShell: {backgroundColor: '#142528', borderRadius: 14, overflow: 'hidden', marginBottom: 22},
  camera: {height: 210, backgroundColor: '#23323C'},
  cameraCaption: {paddingHorizontal: 17, paddingVertical: 15},
  cameraCaptionInactive: {paddingVertical: 19},
  cameraCaptionLabel: {fontSize: 10, fontWeight: '800', letterSpacing: 1.8, color: '#A3D5C7'},
  cameraCue: {fontSize: 18, lineHeight: 24, fontWeight: '700', color: '#FFFFFF', marginTop: 7},
  sceneSummary: {fontSize: 12, lineHeight: 18, fontWeight: '700', letterSpacing: 0.4,
    color: '#A3D5C7', marginTop: 9},
  approachNote: {fontSize: 12, lineHeight: 18, color: '#D6C8A8', marginTop: 6},
  latency: {fontSize: 12, color: '#B1C6BF', marginTop: 7},
  mapShell: {height: 260, overflow: 'hidden', borderRadius: 14, backgroundColor: '#D8E3DD'},
  mapCaption: {fontSize: 14, lineHeight: 20, color: '#526460', marginTop: 10, marginBottom: 11},
  toolsHeading: {borderTopWidth: 1, borderColor: '#CBD4CD', paddingTop: 17, marginTop: 25, marginBottom: 12},
  toolRow: {flexDirection: 'row', gap: 9, marginBottom: 9}, toolHalf: {flex: 1},
  safetyNote: {borderTopWidth: 1, borderColor: '#CBD4CD', paddingTop: 18, marginTop: 30},
  safetyTitle: {fontSize: 16, fontWeight: '800', color: '#273F3D'},
  safetyText: {fontSize: 14, lineHeight: 21, color: '#65736F', marginTop: 7},
});
