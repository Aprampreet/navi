import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {AccessibilityInfo, AppState, NativeEventEmitter, NativeModules, PermissionsAndroid, StatusBar, Vibration,
  View, useWindowDimensions, type ViewStyle} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {SafeAreaProvider, useSafeAreaInsets} from 'react-native-safe-area-context';
import {AlertManager} from './src/alerts';
import {ApproachEstimator} from './src/approach';
import {describeScene, SceneTracker, type Detection} from './src/detections';
import {movementCues, ObjectTracker} from './src/tracking';
import {parseCommand, formatInstruction, shouldAdvanceStep, distanceMeters, type Point, type RouteStep} from './src/navigation';
import {searchPlaces, walkingRoute, type Place} from './src/mapsApi';
import {AmbientReadingTracker, type TextBlock} from './src/reading';
import {destinationChoice, extractDestination, VoiceAgentController} from './src/voiceAgent';
import {cameraZoneForEvent, HapticManager} from './src/haptics';
import {BottomTabs, createTheme, type Appearance, type ScreenName} from './src/ui/design';
import {HomeScreen} from './src/screens/HomeScreen';
import {AssistanceScreen} from './src/screens/AssistanceScreen';
import {NavigationScreen} from './src/screens/NavigationScreen';
import {SettingsScreen, type Verbosity} from './src/screens/SettingsScreen';

const Native = NativeModules.NaviNative;
type Fix = Point & {accuracy: number};
type Frame = {detections: Detection[]; timestamp: number; latencyMs: number};

function NaviApp() {
  const insets = useSafeAreaInsets();
  const {width: screenWidth, height: screenHeight} = useWindowDimensions();
  const [screen, setScreen] = useState<ScreenName>('home');
  const [appearance, setAppearance] = useState<Appearance>('dark');
  const [highContrast, setHighContrast] = useState(false);
  const [largeText, setLargeText] = useState(false);
  const [speechRate, setSpeechRate] = useState(1);
  const [verbosity, setVerbosity] = useState<Verbosity>('all');
  const verbosityRef = useRef<Verbosity>('all');
  const [voiceActivation, setVoiceActivation] = useState(true);
  const [voicePreferenceReady, setVoicePreferenceReady] = useState(false);
  const [displayPreferencesReady, setDisplayPreferencesReady] = useState(false);
  const voiceActivationRef = useRef(true);
  const [cameraPermission, setCameraPermission] = useState('Not checked');
  const [microphonePermission, setMicrophonePermission] = useState('Not checked');
  const [locationPermission, setLocationPermission] = useState('Not checked');
  const [offlineVoice, setOfflineVoice] = useState('Checking');
  const [lastAnnouncement, setLastAnnouncement] = useState('');
  const [guidancePaused, setGuidancePaused] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [assisting, setAssisting] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const cameraReadyRef = useRef(false);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [hapticsEnabled, setHapticsEnabled] = useState(true);
  const [prefsReady, setPrefsReady] = useState(false);
  const [hapticsReady, setHapticsReady] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState('Offline voice starting…');
  const [voiceReady, setVoiceReady] = useState(false);
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
  const [lastReading, setLastReading] = useState('');
  const sceneRef = useRef({text: '', at: 0});
  const readingRef = useRef('');
  const instructionRef = useRef('');
  const voiceStartingCamera = useRef(false);
  const directVoiceInput = useRef(false);
  const endVoiceSession = useRef(false);
  const voiceAgent = useRef(new VoiceAgentController());
  const commandHandler = useRef<(text: string) => Promise<void>>(async () => {});
  const readingTracker = useRef(new AmbientReadingTracker());
  const readingInFlight = useRef(false);
  const stepIndex = useRef(0);
  const approachingStep = useRef(-1);
  const performanceWindow = useRef({since: 0, frames: 0, inferenceTotal: 0, deliveryTotal: 0});
  const sceneTracker = useRef(new SceneTracker());
  const objectTracker = useRef(new ObjectTracker());
  const approachEstimator = useRef(new ApproachEstimator());
  const haptics = useMemo(() => new HapticManager(pattern => Vibration.vibrate(pattern),
    () => Vibration.cancel()), []);
  const theme = useMemo(() => createTheme(highContrast, largeText, appearance),
    [highContrast, largeText, appearance]);
  const alerts = useMemo(() => new AlertManager(async (text, source) => {
    if (source !== 'agent_wake') setLastAnnouncement(text);
    if (source === 'reading' || source === 'agent' || source === 'agent_wake' || source === 'ui')
      await Native.speakOffline(text);
    else await Native.speak(text);
    if (source === 'agent_wake' && !endVoiceSession.current) await Native.resumeVoiceCommand();
    if (source === 'agent') {
      await Native.finishVoiceCommand();
      voiceAgent.current.ready();
      setListening(false);
      if (voiceActivationRef.current) setVoiceStatus('OFFLINE VOICE READY · “HI NAVI” IS EXPERIMENTAL');
      else {
        await Native.stopVoiceAgent();
        setVoiceReady(false);
        setVoiceStatus('HANDS-FREE WAKE OFF');
      }
    }
  }, 5000, (cause, source) => {
    if (source === 'reading') setError(`Offline speech unavailable: ${String(cause)}. The reading is shown on screen.`);
    if (source === 'agent' || source === 'agent_wake') {
      if (endVoiceSession.current) return;
      setError(`Offline voice response failed: ${String(cause)}`);
      voiceAgent.current.error();
      Native.finishVoiceCommand().then(() => voiceAgent.current.ready()).catch(() => {});
      setListening(false);
    }
  }), []);
  alerts.muted = muted; alerts.paused = paused; alerts.commandListening = listening;
  haptics.enabled = hapticsEnabled; haptics.paused = paused; haptics.commandListening = listening;
  voiceActivationRef.current = voiceActivation;
  verbosityRef.current = verbosity;

  useEffect(() => {
    AsyncStorage.getItem('navi.muted').then(value => {
      setMuted(value === 'true'); setPrefsReady(true);
    }).catch(() => setPrefsReady(true));
  }, []);
  useEffect(() => {
    if (prefsReady) AsyncStorage.setItem('navi.muted', String(muted)).catch(() => {});
  }, [muted, prefsReady]);
  useEffect(() => {
    AsyncStorage.getItem('navi.haptics').then(value => {
      setHapticsEnabled(value !== 'false'); setHapticsReady(true);
    }).catch(() => setHapticsReady(true));
  }, []);
  useEffect(() => {
    if (hapticsReady) AsyncStorage.setItem('navi.haptics', String(hapticsEnabled)).catch(() => {});
  }, [hapticsEnabled, hapticsReady]);

  useEffect(() => {
    AsyncStorage.multiGet(['navi.appearance', 'navi.contrast', 'navi.largeText', 'navi.speechRate',
      'navi.verbosity', 'navi.voiceActivation']).then(values => {
      const stored = Object.fromEntries(values);
      setAppearance(stored['navi.appearance'] === 'light' ? 'light' : 'dark');
      setHighContrast(stored['navi.contrast'] === 'true');
      setLargeText(stored['navi.largeText'] === 'true');
      const rate = Number(stored['navi.speechRate']);
      if ([0.85, 1, 1.15].includes(rate)) setSpeechRate(rate);
      setVerbosity(stored['navi.verbosity'] === 'focused' ? 'focused' : 'all');
      setVoiceActivation(stored['navi.voiceActivation'] !== 'false');
      setDisplayPreferencesReady(true); setVoicePreferenceReady(true);
    }).catch(() => { setDisplayPreferencesReady(true); setVoicePreferenceReady(true); });
  }, []);
  useEffect(() => {
    if (!displayPreferencesReady) return;
    AsyncStorage.multiSet([
      ['navi.appearance', appearance],
      ['navi.contrast', String(highContrast)], ['navi.largeText', String(largeText)],
      ['navi.speechRate', String(speechRate)], ['navi.verbosity', verbosity],
      ['navi.voiceActivation', String(voiceActivation)],
    ]).catch(() => {});
    Native.setSpeechRate(speechRate).catch(() => {});
  }, [displayPreferencesReady, appearance, highContrast, largeText, speechRate, verbosity, voiceActivation]);

  useEffect(() => {
    Promise.all([
      PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.CAMERA),
      PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO),
      PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION),
    ]).then(([camera, mic, location]) => {
      setCameraPermission(camera ? 'Granted' : 'Needed');
      setMicrophonePermission(mic ? 'Granted' : 'Needed');
      setLocationPermission(location ? 'Granted' : 'Needed');
      if (location) Native.getLocation().then((value: Fix) => setFix(value)).catch(() => {});
    }).catch(() => {});
    let cancelled = false;
    const checkOfflineSpeech = () => Native.getOfflineVoiceStatus()
      .then((value: {available: boolean}) => {
        if (!cancelled) setOfflineVoice(value.available ? 'Installed' : 'Unavailable');
      }).catch(() => { if (!cancelled) setOfflineVoice('Unavailable'); });
    const timers = [1500, 6000, 15000].map(delay => setTimeout(checkOfflineSpeech, delay));
    return () => { cancelled = true; timers.forEach(clearTimeout); };
  }, []);

  useEffect(() => {
    const context = navigating ? 'NAVIGATING' : steps.length ? 'READY' :
      places.length ? 'CONFIRM' : 'SEARCH';
    Native.setVoiceCommandContext(context).catch(() => {});
  }, [navigating, steps.length, places.length]);

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
      const summary = describeScene(scene.counts);
      sceneRef.current = {text: scene.hasStableObjects ? summary : '', at: receivedAt};
      setSceneSummary(summary);
      setApproachNote(approach.observations.some(observation => observation.zone === 'centre' &&
        observation.state === 'UNKNOWN' && observation.logScaleChange !== null &&
        Math.abs(observation.logScaleChange) >= 0.18) ?
        'Apparent distance uncertain' : '');
      if (!scene.hasStableObjects) setLastCue('');
      const seen = new Set<string>();
      let displayed = false;
      const changes = [...movementCues(tracked.movements), ...scene.events, ...approach.events];
      const hapticCandidates: Array<{key: string; zone: 'left' | 'centre' | 'right'}> = [];
      for (const change of changes) {
        if (seen.has(change.key)) continue;
        seen.add(change.key);
        const zone = cameraZoneForEvent(change, tracked.objects);
        if (zone) hapticCandidates.push({key: change.key, zone});
        const queued = verbosityRef.current === 'focused' && change.priority < 3 ? false :
          alerts.enqueue(change.text, change.priority, change.key, Date.now(), 'camera');
        if (queued || !displayed) { setLastCue(change.text); displayed = true; }
      }
      const tactileCue = hapticCandidates.find(candidate => candidate.zone === 'centre') || hapticCandidates[0];
      if (tactileCue) haptics.camera(tactileCue.key, tactileCue.zone, receivedAt);
      else {
        const apparentApproach = approach.events.find(cue => cue.key.startsWith('approach:'));
        if (apparentApproach) haptics.approach(apparentApproach.key, receivedAt);
      }
    });
    const cameraError = emitter.addListener('NaviCameraError', (event: Object) => {
      setError(`Camera or model unavailable: ${(event as {message: string}).message}`);
      sceneRef.current = {text: '', at: 0}; readingRef.current = '';
      readingTracker.current.reset(); setLastReading('');
      setStatus('Camera unavailable'); cameraReadyRef.current = false; setCameraReady(false); setAssisting(false);
      setNavigating(false); setSceneSummary(''); setApproachNote(''); setLastCue('');
      setLatency(null); setFps(null); setDeliveryMs(null);
      performanceWindow.current = {since: 0, frames: 0, inferenceTotal: 0, deliveryTotal: 0};
      sceneTracker.current.reset(); objectTracker.current.reset(); approachEstimator.current.reset();
      alerts.clear(); haptics.reset(); Native.stopSpeech();
      haptics.error('camera');
      alerts.enqueue('Camera assistance stopped. Check the camera before continuing.',
        5, 'camera-error', Date.now(), 'system');
    });
    const cameraStarted = emitter.addListener('NaviCameraReady', () => {
      if (cameraReadyRef.current) return;
      cameraReadyRef.current = true;
      setCameraReady(true);
      setStatus('Detecting objects in the camera view');
      haptics.confirmed();
      if (!voiceStartingCamera.current)
        alerts.enqueue('Assistance started. Camera detection is active.', 2, 'assistance-start');
      voiceStartingCamera.current = false;
    });
    const appState = AppState.addEventListener('change', state => {
      if (state === 'background') {
        cameraReadyRef.current = false; setCameraReady(false); setAssisting(false); setNavigating(false);
        setSceneSummary(''); setApproachNote(''); setLastCue('');
        setLatency(null); setFps(null); setDeliveryMs(null);
        performanceWindow.current = {since: 0, frames: 0, inferenceTotal: 0, deliveryTotal: 0};
        sceneTracker.current.reset(); objectTracker.current.reset(); approachEstimator.current.reset();
        readingTracker.current.reset(); setLastReading('');
        sceneRef.current = {text: '', at: 0}; readingRef.current = '';
        alerts.clear(); haptics.reset(); Native.stopSpeech();
        Native.stopVoiceAgent().catch(() => {});
        setVoiceReady(false);
      } else if (state === 'active') {
        if (voiceActivationRef.current) PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO)
          .then(granted => { if (granted) Native.startVoiceAgent().catch(() => {}); });
      }
    });
    return () => { detections.remove(); cameraError.remove(); cameraStarted.remove(); appState.remove(); };
  }, [alerts, haptics]);

  useEffect(() => {
    const emitter = new NativeEventEmitter(Native);
    const ready = emitter.addListener('NaviVoiceReady', () => {
      voiceAgent.current.activate();
      setVoiceReady(true);
      setVoiceStatus('OFFLINE VOICE READY · “HI NAVI” IS EXPERIMENTAL');
      setError(previous => previous.startsWith('Offline voice could not start:') ? '' : previous);
    });
    const wake = emitter.addListener('NaviVoiceWake', () => {
      if (!voiceAgent.current.wake()) return;
      endVoiceSession.current = false;
      directVoiceInput.current = false;
      haptics.voice('wake');
      setListening(true);
      setVoiceStatus('LISTENING FOR COMMAND');
      alerts.clearCamera(); alerts.clearReading();
      alerts.enqueue("I'm listening.", 5, `voice-wake-${Date.now()}`, Date.now(), 'agent_wake');
    });
    const command = emitter.addListener('NaviVoiceCommand', (event: Object) => {
      haptics.voice('heard');
      commandHandler.current((event as {text: string}).text).catch(cause => {
        setError(`Voice command failed: ${String(cause)}`);
        Native.finishVoiceCommand().catch(() => {});
        setListening(false);
      });
    });
    const timeout = emitter.addListener('NaviVoiceTimeout', (event: Object) => {
      haptics.error('voice-timeout');
      directVoiceInput.current = false;
      endVoiceSession.current = true;
      setListening(false);
      voiceAgent.current.ready();
      setVoiceStatus('OFFLINE VOICE READY · “HI NAVI” IS EXPERIMENTAL');
      alerts.enqueue((event as {text: string}).text || 'I did not hear a command. Try again.', 5,
        `voice-timeout-${Date.now()}`, Date.now(), 'agent');
    });
    const failure = emitter.addListener('NaviVoiceError', (event: Object) => {
      haptics.error('voice');
      directVoiceInput.current = false;
      voiceAgent.current.error(); setListening(false);
      setVoiceReady(false);
      setVoiceStatus('OFFLINE VOICE UNAVAILABLE');
      setError(`Offline microphone: ${(event as {text: string}).text || 'unavailable'}. Use the on-screen controls.`);
    });
    return () => { ready.remove(); wake.remove(); command.remove(); timeout.remove(); failure.remove(); };
  }, [alerts, haptics]);

  useEffect(() => {
    if (!voicePreferenceReady) return;
    if (!voiceActivation) {
      Native.stopVoiceAgent().catch(() => {});
      setVoiceReady(false);
      setVoiceStatus('HANDS-FREE WAKE OFF');
      return;
    }
    PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO).then(granted => {
      if (granted === PermissionsAndroid.RESULTS.GRANTED) {
        setMicrophonePermission('Granted');
        Native.startVoiceAgent().catch((cause: unknown) => {
          setVoiceReady(false);
          setVoiceStatus('OFFLINE VOICE UNAVAILABLE');
          setError(`Offline voice could not start: ${String(cause)}`);
        });
      } else {
        setMicrophonePermission('Needed');
        setVoiceReady(false);
        setVoiceStatus('MICROPHONE PERMISSION NEEDED');
      }
    });
  }, [voicePreferenceReady, voiceActivation]);

  async function request(permission: string): Promise<boolean> {
    const granted = (await PermissionsAndroid.request(permission as any)) ===
      PermissionsAndroid.RESULTS.GRANTED;
    if (permission === PermissionsAndroid.PERMISSIONS.CAMERA) setCameraPermission(granted ? 'Granted' : 'Needed');
    if (permission === PermissionsAndroid.PERMISSIONS.RECORD_AUDIO)
      setMicrophonePermission(granted ? 'Granted' : 'Needed');
    if (permission === PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION)
      setLocationPermission(granted ? 'Granted' : 'Needed');
    return granted;
  }
  async function refreshLocation(): Promise<Fix | null> {
    if (!await request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION)) {
      haptics.error('gps-permission');
      setError('Precise location permission denied. Map routing needs GPS.'); return null;
    }
    try { const location = await Native.getLocation() as Fix; setFix(location); return location; }
    catch (e) { haptics.error('gps'); setError(`GPS unavailable: ${String(e)}`); return null; }
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
    readingTracker.current.reset(); setLastReading('');
    sceneTracker.current.reset(); objectTracker.current.reset(); approachEstimator.current.reset();
    haptics.reset();
    alerts.clearCamera();
    setAssisting(true); setPaused(false); alerts.paused = false; haptics.paused = false;
    setStatus('Starting camera preview…');
    void refreshLocation();
    return true;
  }
  function stop(announce = true) {
    readingTracker.current.reset(); setLastReading('');
    cameraReadyRef.current = false; setCameraReady(false); setLatency(null); setFps(null);
    setDeliveryMs(null); performanceWindow.current = {since: 0, frames: 0,
      inferenceTotal: 0, deliveryTotal: 0};
    setAssisting(false); setNavigating(false); setGuidancePaused(false); setCurrentStep(0);
    setPaused(false); haptics.paused = false; setPoints([]);
    setSteps([]); setPlaces([]); setSelected(null); stepIndex.current = 0; approachingStep.current = -1;
    setLastInstruction(''); setTranscript(''); setLastCue(''); setSceneSummary(''); setApproachNote('');
    sceneTracker.current.reset(); objectTracker.current.reset(); approachEstimator.current.reset();
    haptics.reset();
    alerts.clear(); Native.stopSpeech(); setStatus('Navigation stopped');
    if (announce) alerts.enqueue('Navigation stopped.', 2, 'navigation-stop');
  }
  function stopCameraOnly() {
    cameraReadyRef.current = false; setCameraReady(false); setAssisting(false);
    sceneTracker.current.reset(); objectTracker.current.reset(); approachEstimator.current.reset();
    readingTracker.current.reset(); sceneRef.current = {text: '', at: 0}; readingRef.current = '';
    haptics.reset();
    setSceneSummary(''); setApproachNote(''); setLastCue(''); setLastReading('');
    alerts.clearCamera(); alerts.clearReading();
    setStatus(navigating ? 'Camera stopped. Walking guidance continues.' : 'Camera assistance stopped.');
  }
  function stopNavigationOnly() {
    setNavigating(false); setGuidancePaused(false); setCurrentStep(0);
    setPoints([]); setSteps([]); setPlaces([]); setSelected(null);
    setLastInstruction(''); instructionRef.current = '';
    stepIndex.current = 0; approachingStep.current = -1;
    alerts.clearNavigation();
    haptics.reset();
    setStatus(assisting ? 'Walking guidance stopped. Camera assistance continues.' : 'Walking guidance stopped.');
  }
  async function listen() {
    setError('');
    if (!await request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO)) {
      setError('Microphone permission denied. Use the on-screen controls.'); return;
    }
    try {
      await Native.startVoiceAgent();
      await Native.beginVoiceCommand();
      endVoiceSession.current = false;
      directVoiceInput.current = true;
      voiceAgent.current.activate(); voiceAgent.current.wake();
      setListening(true); setVoiceStatus('LISTENING FOR COMMAND');
      haptics.voice('wake');
      alerts.clearCamera(); alerts.clearReading();
      alerts.enqueue("I'm listening.", 5, `voice-button-${Date.now()}`, Date.now(), 'agent_wake');
    } catch (cause) { setError(`Offline microphone unavailable: ${String(cause)}`); }
  }
  function endVoiceSessionNow() {
    endVoiceSession.current = true;
    directVoiceInput.current = false;
    alerts.clearAgent();
    if (alerts.currentSource === 'agent' || alerts.currentSource === 'agent_wake') Native.stopSpeech();
    if (voiceActivationRef.current) Native.finishVoiceCommand().catch(() => {});
    else Native.stopVoiceAgent().catch(() => {});
    voiceAgent.current.ready();
    setListening(false);
    setVoiceStatus(voiceActivationRef.current ?
      'OFFLINE VOICE READY · “HI NAVI” IS EXPERIMENTAL' : 'HANDS-FREE WAKE OFF');
  }

  async function searchDestination(destination: string) {
    const location = fix || await refreshLocation();
    if (!location) throw new Error('GPS is unavailable for place search');
    setNavigating(false); setGuidancePaused(false); setCurrentStep(0);
    setPoints([]); setSteps([]); setSelected(null);
    setLastInstruction(''); instructionRef.current = '';
    stepIndex.current = 0; approachingStep.current = -1;
    setStatus(`Searching for ${destination}`);
    const results = await searchPlaces(destination, location);
    setPlaces(results);
    if (!results.length) throw new Error('No nearby walking destination found. Try a clearer place and city name.');
    setScreen('navigation');
    setStatus('Destination found. Choose and confirm a place.');
    return `I found ${results.length} ${results.length === 1 ? 'place' : 'places'}. ` +
      `First: ${results[0].name}, ${results[0].address}. ` +
      (results.length === 1 ? 'Say Hi NAVI, then confirm destination.' :
        'Check the results on screen. Say Hi NAVI, then confirm first destination, or choose another option.');
  }
  async function confirm(place: Place, announce = true): Promise<boolean> {
    const origin = await refreshLocation(); if (!origin) return false;
    try {
      setError(''); setSelected(place); setStatus(`Loading walking route to ${place.name}`);
      const route = await walkingRoute(origin, place.point);
      setPoints(route.points); setSteps(route.steps); setCurrentStep(0);
      stepIndex.current = 0; approachingStep.current = -1;
      setStatus('Route ready. Start navigation when ready.');
      haptics.confirmed();
      if (announce) alerts.enqueue(`Route ready to ${place.name}. Start navigation when ready.`, 2, 'route-ready');
      return true;
    } catch (e) {
      haptics.error('route'); setSelected(null); setError(`Walking route unavailable: ${String(e)}`);
      return false;
    }
  }
  const announceStep = useCallback((step: RouteStep) => {
    const instruction = formatInstruction(step.instruction);
    setLastInstruction(instruction); instructionRef.current = instruction;
    haptics.route(instruction);
    alerts.enqueue(instruction, 4, `step-${stepIndex.current}`, Date.now(), 'navigation');
  }, [alerts, haptics]);
  async function startNavigation(announce = true): Promise<boolean> {
    if (!steps.length) { setError('No route steps available.'); return false; }
    if (!assisting && !await startAssistance()) return false;
    setNavigating(true); setGuidancePaused(false); setCurrentStep(0);
    setStatus('Navigating and detecting');
    if (announce) announceStep(steps[0]);
    else {
      const instruction = formatInstruction(steps[0].instruction);
      setLastInstruction(instruction); instructionRef.current = instruction;
      haptics.route(instruction);
    }
    return true;
  }
  function repeat() {
    if (lastInstruction) {
      haptics.route(lastInstruction);
      alerts.enqueue(lastInstruction, 4, `repeat-${Date.now()}`, Date.now(), 'navigation');
    }
  }
  function toggleGuidancePause(repeatOnResume = true) {
    if (!navigating) return;
    const next = !guidancePaused;
    setGuidancePaused(next);
    if (next) alerts.clearNavigation();
    setStatus(next ? 'Walking guidance paused. Camera assistance continues.' :
      'Walking guidance resumed. Check the current instruction.');
    if (!next && repeatOnResume && instructionRef.current) repeat();
  }

  async function handleVoiceCommand(text: string) {
    setTranscript(text);
    const intent = voiceAgent.current.command(text);
    endVoiceSession.current = false;
    let response = '';
    try {
      switch (intent) {
        case 'start_camera': {
          if (assisting && cameraReadyRef.current) { response = 'Camera assistance is already active.'; break; }
          voiceStartingCamera.current = true;
          setScreen('assistance');
          if (!await startAssistance()) { voiceStartingCamera.current = false; response = 'Camera permission is needed. Use the on-screen controls.'; break; }
          const deadline = Date.now() + 8000;
          while (!cameraReadyRef.current && Date.now() < deadline) {
            await new Promise<void>(resolve => setTimeout(resolve, 200));
          }
          voiceStartingCamera.current = false;
          response = cameraReadyRef.current ? 'Camera assistance started.' : 'The camera did not start. Please check the screen.';
          break;
        }
        case 'stop_camera':
          if (assisting) { stopCameraOnly(); response = 'Camera assistance stopped.'; }
          else response = 'Camera assistance is already off.';
          break;
        case 'describe': {
          const scene = sceneRef.current;
          response = cameraReadyRef.current && scene.text && Date.now() - scene.at <= 3500 ?
            `${scene.text} visible in the camera view.` : "I don't have a reliable current camera view.";
          break;
        }
        case 'read_last_text': response = readingRef.current || 'I have not read clear text yet.'; break;
        case 'destination': {
          const destination = extractDestination(text);
          response = destination ? await searchDestination(destination) : 'Please say a destination after go to.';
          break;
        }
        case 'change_destination':
          stopNavigationOnly();
          response = 'Ready for a new destination. Say Hi NAVI, then go to the place you want.';
          break;
        case 'confirm_destination': {
          if (!places.length) { response = 'No destination results are available. Say Hi NAVI, then go to a place.'; break; }
          const choice = destinationChoice(text);
          if (choice === null && places.length > 1) {
            response = 'There are multiple results. Say confirm first destination, or name an option number.';
            break;
          }
          const place = places[choice ?? 0];
          if (!place) { response = `That option is unavailable. Choose from one to ${places.length}.`; break; }
          response = await confirm(place, false) ?
            `Walking route ready to ${place.name}. Say Hi NAVI, then start walking guidance when ready.` :
            'I could not create a walking route. Check the connection and try again.';
          break;
        }
        case 'start_navigation': {
          if (navigating) { response = 'Walking guidance is already active.'; break; }
          if (!steps.length) { response = 'No route is ready. Say Hi NAVI, then go to your destination.'; break; }
          voiceStartingCamera.current = !assisting;
          const started = await startNavigation(false);
          if (!started) voiceStartingCamera.current = false;
          response = started ? `Walking guidance started. ${formatInstruction(steps[0].instruction)}` :
            'Walking guidance could not start. Check camera permission and the route on screen.';
          if (started) setScreen('navigation');
          break;
        }
        case 'stop_navigation':
          if (navigating || steps.length) { stopNavigationOnly(); response = 'Walking guidance stopped. Camera assistance continues if it is on.'; }
          else response = 'Walking guidance is already off.';
          break;
        case 'pause_navigation':
          if (navigating && !guidancePaused) { toggleGuidancePause(); response = 'Walking guidance paused. Camera assistance continues.'; }
          else response = 'Walking guidance is not active.';
          break;
        case 'resume_navigation':
          if (navigating && guidancePaused) { toggleGuidancePause(false); response = 'Walking guidance resumed.'; }
          else response = 'Walking guidance is not paused.';
          break;
        case 'repeat_turn':
          response = instructionRef.current || 'There is no walking instruction yet.';
          if (instructionRef.current) haptics.route(instructionRef.current);
          break;
        case 'route_status': response = navigating ?
          `Walking guidance to ${selected?.name || 'your destination'} is ${guidancePaused ? 'paused' : 'active'}. Next: ${instructionRef.current || 'follow the route on screen'}.` :
          steps.length ? `A walking route to ${selected?.name || 'your destination'} is ready. Say Hi NAVI, then start walking guidance.` :
          places.length ? 'Destination results are waiting for your confirmation.' : 'No walking route is loaded.';
          break;
        case 'refresh_gps': {
          const location = await refreshLocation();
          response = location ? `GPS updated. Reported accuracy is about ${Math.round(location.accuracy)} metres.` :
            'GPS is unavailable. Check location permission and try again.';
          break;
        }
        case 'repeat': response = voiceAgent.current.lastResponse || instructionRef.current || 'There is nothing to repeat yet.'; break;
        case 'pause_alerts':
          alerts.paused = true; haptics.paused = true;
          alerts.clearCamera(); alerts.clearReading(); setPaused(true);
          response = 'Camera and text alerts paused, including camera haptics.'; break;
        case 'resume_alerts':
          alerts.paused = false; haptics.paused = false;
          setPaused(false); response = 'Camera and text alerts resumed.'; break;
        case 'mute':
          alerts.muted = true; setMuted(true); alerts.clearCamera(); alerts.clearReading();
          response = 'Voice alerts muted. You can say Hi NAVI, then unmute.'; break;
        case 'unmute': alerts.muted = false; setMuted(false); response = 'Voice alerts unmuted.'; break;
        case 'haptics_on':
          haptics.enabled = true; setHapticsEnabled(true); haptics.voice('wake');
          response = 'Haptics on.'; break;
        case 'haptics_off':
          haptics.enabled = false; haptics.reset(); setHapticsEnabled(false);
          response = 'Haptics off.'; break;
        case 'stop': stop(false); response = 'Navigation and camera stopped.'; break;
        case 'cancel': response = 'Cancelled.'; break;
        default: {
          const oldCommand = parseCommand(text);
          if (directVoiceInput.current && oldCommand.type === 'destination')
            response = await searchDestination(oldCommand.destination);
          else response = 'I did not understand. Try go to a destination, start walking guidance, or describe my surroundings.';
        }
      }
    } catch (cause) {
      haptics.error('command');
      response = `I could not complete that command. ${String(cause)}`;
      setError(response);
    }
    if (intent !== 'repeat') voiceAgent.current.speaking(response);
    directVoiceInput.current = false;
    setVoiceStatus('RESPONDING');
    alerts.enqueue(response, 5, `voice-response-${Date.now()}`, Date.now(), 'agent');
  }
  commandHandler.current = handleVoiceCommand;

  useEffect(() => {
    if (!assisting || !cameraReady) return;
    let cancelled = false;
    let nextScan: ReturnType<typeof setTimeout>;
    async function scan() {
      if (cancelled || !cameraReadyRef.current) return;
      if (readingInFlight.current) {
        nextScan = setTimeout(() => {scan();}, 500);
        return;
      }
      readingInFlight.current = true;
      try {
        const result = await Native.readSurroundings() as {blocks: TextBlock[]};
        if (cancelled) return;
        for (const cue of readingTracker.current.update(Array.isArray(result.blocks) ? result.blocks : [], Date.now())) {
          setLastReading(cue); readingRef.current = cue;
          haptics.reading(cue);
          const voice = await Native.getOfflineVoiceStatus() as {available: boolean; language: string};
          if (cancelled) return;
          if (!voice.available) setError(`No installed offline voice for ${voice.language}. Visible text is shown on screen.`);
          else alerts.enqueue(cue, 2, `text-${cue}`, Date.now(), 'reading');
        }
      } catch (cause) {
        if (!cancelled) console.warn('Local text scan failed', cause);
      } finally {
        readingInFlight.current = false;
        if (!cancelled) nextScan = setTimeout(() => {scan();}, 1500);
      }
    }
    nextScan = setTimeout(() => {scan();}, 400);
    return () => { cancelled = true; clearTimeout(nextScan); };
  }, [assisting, cameraReady, alerts, haptics]);

  useEffect(() => {
    if (!navigating || guidancePaused) return;
    const timer = setInterval(async () => {
      try {
        const location = await Native.getLocation() as Fix; setFix(location);
        const nextIndex = stepIndex.current + 1;
        const next = steps[nextIndex];
        if (next && shouldAdvanceStep(location, next, location.accuracy)) {
          stepIndex.current += 1; setCurrentStep(stepIndex.current); announceStep(next);
          if (stepIndex.current === steps.length - 1) {
            setNavigating(false); setStatus('Destination reached. Confirm your surroundings.');
          }
        } else if (next && location.accuracy <= 35 && approachingStep.current !== nextIndex) {
          const distance = distanceMeters(location, next.point);
          if (distance <= 65 && distance > Math.max(18, location.accuracy)) {
            approachingStep.current = nextIndex;
            haptics.route(next.instruction);
            alerts.enqueue(`In about ${Math.round(distance / 10) * 10} metres, ${formatInstruction(next.instruction)}`,
              4, `approach-${nextIndex}`, Date.now(), 'navigation');
          }
        } else if (location.accuracy > 35) {
          haptics.error('gps-poor'); setStatus('GPS accuracy is poor. Check surroundings.');
        }
      } catch {
        haptics.error('gps-lost'); setStatus('GPS unavailable. Guidance paused until location returns.');
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [navigating, guidancePaused, steps, announceStep, alerts, haptics]);

  const gpsState = locationPermission !== 'Granted' ? 'Permission needed' :
    fix ? (fix.accuracy <= 35 ? 'Last fix ±' + Math.round(fix.accuracy) + ' m' :
      'Low accuracy ±' + Math.round(fix.accuracy) + ' m') : 'Acquiring fix';
  const voiceState = !voiceActivation ? 'Off' : listening ? 'Listening' :
    voiceReady ? 'Ready for Hi NAVI' : microphonePermission === 'Needed' ?
      'Permission needed' : voiceStatus.includes('UNAVAILABLE') ? 'Unavailable' : 'Starting';

  function changeScreen(next: ScreenName) {
    setScreen(next);
    AccessibilityInfo.isScreenReaderEnabled().then(enabled => {
      if (enabled) AccessibilityInfo.announceForAccessibility(
        next === 'home' ? 'Home screen' : next === 'assistance' ? 'Live assistance screen' :
          next === 'navigation' ? 'Walking guidance screen' : 'Settings screen');
    }).catch(() => {});
  }
  function describeNow() {
    const scene = sceneRef.current;
    const message = cameraReadyRef.current && scene.text && Date.now() - scene.at <= 3500 ?
      scene.text + ' visible in the camera view.' : 'I do not have a reliable current camera view.';
    alerts.enqueue(message, 5, 'describe-ui-' + Date.now(), Date.now(), 'ui');
  }
  function repeatLastNow() {
    if (lastAnnouncement) alerts.enqueue(lastAnnouncement, 5,
      'repeat-ui-' + Date.now(), Date.now(), 'ui');
  }
  function toggleCameraAlerts() {
    const next = !paused;
    alerts.paused = next; haptics.paused = next;
    if (next) { alerts.clearCamera(); alerts.clearReading(); }
    setPaused(next);
  }
  function toggleHaptics() {
    const next = !hapticsEnabled;
    haptics.enabled = next; haptics.reset(); setHapticsEnabled(next);
    if (next) haptics.voice('wake');
  }
  async function toggleWake() {
    if (voiceActivation) { setVoiceActivation(false); return; }
    if (await request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO)) setVoiceActivation(true);
    else setError('Microphone permission is needed for hands-free voice activation.');
  }
  async function checkSettingsPermissions() {
    const [camera, mic, location] = await Promise.all([
      PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.CAMERA),
      PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO),
      PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION),
    ]);
    setCameraPermission(camera ? 'Granted' : 'Needed');
    setMicrophonePermission(mic ? 'Granted' : 'Needed');
    setLocationPermission(location ? 'Granted' : 'Needed');
    if (location) await refreshLocation();
    Native.getOfflineVoiceStatus().then((value: {available: boolean}) =>
      setOfflineVoice(value.available ? 'Installed' : 'Unavailable')).catch(() =>
      setOfflineVoice('Unavailable'));
  }
  function openAssistance() {
    if (assisting) { changeScreen('assistance'); return; }
    startAssistance().then(started => { if (started) changeScreen('assistance'); });
  }

  const hiddenAssistance: ViewStyle = screen === 'assistance' ? {flex: 1} :
    {position: 'absolute', left: -screenWidth - 80, top: 0, width: screenWidth,
      height: Math.max(screenHeight, 800), opacity: 0};

  return <View style={{flex: 1, backgroundColor: theme.background, paddingTop: insets.top}}>
    <StatusBar barStyle={appearance === 'light' && !highContrast ? 'dark-content' : 'light-content'}
      backgroundColor={theme.background} />
    {screen === 'home' && <HomeScreen theme={theme} assisting={assisting} cameraReady={cameraReady}
      navigating={navigating} voiceState={voiceState} gpsState={gpsState} offlineVoice={offlineVoice}
      lastAnnouncement={lastAnnouncement} transcript={transcript} listening={listening}
      error={error} onAssistance={openAssistance}
      onNavigate={() => changeScreen('navigation')} onDescribe={describeNow}
      onRepeat={repeatLastNow} onSettings={() => changeScreen('settings')} onVoice={listen}
      onEndVoice={endVoiceSessionNow} />}
    {screen === 'navigation' && <NavigationScreen theme={theme} destination={selected}
      places={places} position={fix} route={points} stepCount={steps.length}
      currentStep={currentStep} instruction={lastInstruction} navigating={navigating}
      guidancePaused={guidancePaused} gpsState={gpsState} error={error} status={status}
      transcript={transcript} listening={listening} onVoice={listen}
      onEndVoice={endVoiceSessionNow} onConfirm={place => {void confirm(place);}}
      onStart={() => {void startNavigation();}} onPause={toggleGuidancePause}
      onRepeat={repeat} onStop={stopNavigationOnly}
      onRefresh={() => {void refreshLocation();}} />}
    {screen === 'settings' && <SettingsScreen theme={theme} appearance={appearance} speechRate={speechRate}
      verbosity={verbosity} hapticsEnabled={hapticsEnabled} highContrast={highContrast}
      largeText={largeText} voiceActivation={voiceActivation} voiceState={voiceState}
      offlineVoice={offlineVoice} cameraPermission={cameraPermission}
      microphonePermission={microphonePermission} locationPermission={locationPermission}
      onSpeechRate={setSpeechRate} onVerbosity={setVerbosity} onHaptics={toggleHaptics}
      onAppearance={value => { setAppearance(value); setHighContrast(false); }}
      onContrast={() => setHighContrast(!highContrast)}
      onLargeText={() => setLargeText(!largeText)}
      onVoiceActivation={() => {void toggleWake();}}
      onCheckPermissions={() => {void checkSettingsPermissions();}} />}
    <View style={hiddenAssistance} pointerEvents={screen === 'assistance' ? 'auto' : 'none'}
      importantForAccessibility={screen === 'assistance' ? 'auto' : 'no-hide-descendants'}
      accessibilityElementsHidden={screen !== 'assistance'}>
      <AssistanceScreen theme={theme} assisting={assisting} cameraReady={cameraReady}
        paused={paused} lastCue={lastCue} lastReading={lastReading}
        sceneSummary={sceneSummary} approachNote={approachNote} fps={fps}
        latency={latency} deliveryMs={deliveryMs} error={error} listening={listening}
        onStart={() => {void startAssistance();}} onPause={toggleCameraAlerts}
        onStop={stopCameraOnly} onRepeat={repeatLastNow} onDescribe={describeNow}
        onVoice={listen} onEndVoice={endVoiceSessionNow} />
    </View>
    <View style={{paddingBottom: insets.bottom, backgroundColor: theme.surface}}>
      <BottomTabs active={screen} onChange={changeScreen} theme={theme} />
    </View>
  </View>;
}

export default function App() { return <SafeAreaProvider><NaviApp /></SafeAreaProvider>; }
