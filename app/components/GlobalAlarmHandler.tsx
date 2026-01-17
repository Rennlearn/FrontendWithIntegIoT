import React, { useEffect, useRef, useState } from 'react';
import { Alert, DeviceEventEmitter } from 'react-native';
import BluetoothService from '@/services/BluetoothService';
// CRITICAL: Use explicit relative import to avoid ambiguity with duplicate AlarmModal files
// This ensures the correct AlarmModal from app/components is used
import AlarmModal from './AlarmModal';
import PillMismatchModal from './PillMismatchModal';
import verificationService from '@/services/verificationService';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { soundService } from '@/services/soundService';
import { markScheduleTakenInstant, updateScheduleCache } from '@/services/scheduleStatusService';
import { alarmTriggerTracker } from '@/services/alarmTriggerTracker';
import { modalController } from '@/services/ModalController';

type PendingMismatch = {
  container: number;
  ts: number;
};

// Queue item for multiple simultaneous alarms
type AlarmQueueItem = {
  container: number;
  time: string;
  key: string;
  ts: number;
};

/**
 * Single global place to:
 * - listen to Bluetooth messages (ALARM_TRIGGERED / ALARM_STOPPED / PILLALERT)
 * - show modals on ANY screen (prevents "it only works on MonitorManageScreen")
 * - trigger per-container captures pre/post alarm and on mismatch
 *
 * IMPROVED: Now supports QUEUE-BASED ALARMS for multiple containers at the same time.
 * When 3 pills are scheduled at the same time (1 per container), all 3 alarms are queued
 * and shown one-by-one as each is dismissed.
 */
// CRITICAL: Normalize container IDs to prevent data mixing
// Ensures consistent parsing of container identifiers (numeric, "container1", "morning", etc.)
const normalizeContainer = (raw: any): 1 | 2 | 3 => {
  if (raw === null || raw === undefined) return 1;
  const s = String(raw).trim().toLowerCase();

  // Extract first digit sequence (handles "1", "01", "container2", etc.)
  const m = s.match(/(\d+)/);
  if (m) {
    const n = parseInt(m[1], 10);
    if (n === 1 || n === 2 || n === 3) return n as 1 | 2 | 3;
  }

  // Legacy string labels
  if (s === 'morning') return 1;
  if (s === 'noon') return 2;
  if (s === 'evening' || s === 'night') return 3;

  // Fallback to container 1 for any unknown format
  return 1;
};

export default function GlobalAlarmHandler() {
  const [alarmVisible, setAlarmVisible] = useState(false);
  const [alarmContainer, setAlarmContainer] = useState(1);
  const [alarmTime, setAlarmTime] = useState('00:00');
  const [alarmIsScheduled, setAlarmIsScheduled] = useState(false); // Track if alarm matches a scheduled medication
  
  // NEW: Remaining alarms count for user feedback
  const [remainingAlarms, setRemainingAlarms] = useState(0);

  const [pillMismatchVisible, setPillMismatchVisible] = useState(false);
  const [pillMismatchContainer, setPillMismatchContainer] = useState(1);
  const [pillMismatchExpected, setPillMismatchExpected] = useState('unknown');
  const [pillMismatchDetected, setPillMismatchDetected] = useState('none');
  const [pillMismatchCount, setPillMismatchCount] = useState(0);
  const [pillMismatchExpectedCount, setPillMismatchExpectedCount] = useState(0);
  const [pillMismatchForeignPills, setPillMismatchForeignPills] = useState(false);
  const [pillMismatchForeignLabels, setPillMismatchForeignLabels] = useState<string[]>([]);

  // MODAL CONTROLLER: Single source of truth for all modal state
  // These refs are used by ModalController for synchronous state checks (no stale closures)
  const activeModalRef = useRef<'ALARM' | 'PILL_MISMATCH' | null>(null);
  const alarmLockRef = useRef<boolean>(false);
  const mismatchLockRef = useRef<boolean>(false);

  // IMPROVED: Alarm queue for multiple simultaneous alarms
  // MAX_QUEUE_SIZE: Prevent unbounded growth under heavy scheduling load
  const MAX_QUEUE_SIZE = 50;
  const alarmQueueRef = useRef<AlarmQueueItem[]>([]);
  const processedAlarmsRef = useRef<Set<string>>(new Set()); // track shown alarms to prevent duplicates
  const cleanupTimersRef = useRef<Set<NodeJS.Timeout>>(new Set()); // track cleanup timers to prevent leaks

  const lastAlarmKeyRef = useRef<string>('');
  const lastAlarmShownAtRef = useRef<number>(0);
  const lastMismatchShownAtRef = useRef<number>(0);
  const lastMismatchByContainerRef = useRef<Map<number, { shownAt: number; verificationTs?: string }>>(new Map());
  const mismatchInFlightRef = useRef<Set<number>>(new Set());
  const pendingMismatchRef = useRef<PendingMismatch | null>(null);
  // REMOVED: pendingMismatchTimerRef and pendingMismatchCandidateRef - no longer using setTimeout
  
  // HARD GUARD: Track handled mismatches by unique ID to prevent duplicates
  // Key format: `${containerNum}|${verificationTs || timestamp}`
  // This ensures each distinct mismatch event is handled only once
  const handledMismatchIdsRef = useRef<Set<string>>(new Set());
  const lastMismatchIdRef = useRef<string>(''); // Track last shown mismatch ID

  // IMPORTANT: onDataReceived callback is registered once; use refs to avoid stale state.
  const alarmVisibleRef = useRef<boolean>(false);
  const alarmContainerRef = useRef<number>(1);
  const pillMismatchVisibleRef = useRef<boolean>(false);
  const alarmSessionActiveRef = useRef<boolean>(false); // true only for "take pill" schedule alarm session
  const alarmStoppedByUserRef = useRef<boolean>(false); // Track if user explicitly stopped the alarm (prevents showing next alarm)

  // Initialize ModalController on mount
  // SINGLE SOURCE OF TRUTH: All modal state is managed by ModalController
  useEffect(() => {
    modalController.initialize(activeModalRef, alarmLockRef, mismatchLockRef);
    
    // Subscribe to modal state changes to sync React state
    // CRITICAL: State sync happens SYNCHRONOUSLY - no render delays
    const unsubscribe = modalController.onStateChange(() => {
      // Read state directly from ref (synchronous, no stale closures)
      const activeModal = activeModalRef.current;
      
      // Sync alarm visibility IMMEDIATELY (synchronous state update)
      // Use functional updates to ensure we get latest state
      setAlarmVisible((prev) => {
        const shouldShow = activeModal === 'ALARM';
        if (shouldShow !== prev) {
          alarmVisibleRef.current = shouldShow;
          return shouldShow;
        }
        return prev;
      });
      
      // Sync mismatch visibility IMMEDIATELY (only if alarm is not active)
      setPillMismatchVisible((prev) => {
        const shouldShow = activeModal === 'PILL_MISMATCH';
        if (shouldShow !== prev) {
          pillMismatchVisibleRef.current = shouldShow;
          return shouldShow;
        }
        return prev;
      });
    });

    return unsubscribe;
  }, []); // Only run once on mount

  // SYNCHRONOUS state setters - no delays, immediate updates
  // CRITICAL: These functions update React state AND ModalController refs synchronously
  // Modal visibility is driven by activeModalRef.current, not React state (for instant display)
  const setAlarmVisibleSafe = (v: boolean) => {
    // CRITICAL: Prevent duplicate modals - don't set if already in desired state
    if (v && (alarmVisibleRef.current || activeModalRef.current === 'ALARM')) {
      console.log('[GlobalAlarmHandler] ⏳ Alarm already visible, skipping duplicate set');
      return;
    }
    if (!v && !alarmVisibleRef.current && activeModalRef.current !== 'ALARM') {
      // Already hidden, no need to update
      return;
    }
    
    alarmVisibleRef.current = v;
    setAlarmVisible(v);
    // Sync with ModalController (single source of truth)
    // CRITICAL: activeModalRef is updated IMMEDIATELY, modal appears on next render
    if (v) {
      activeModalRef.current = 'ALARM';
    } else if (activeModalRef.current === 'ALARM') {
      activeModalRef.current = null;
    }
  };
  const setAlarmContainerSafe = (v: number) => {
    alarmContainerRef.current = v;
    setAlarmContainer(v);
  };
  const setPillMismatchVisibleSafe = (v: boolean) => {
    pillMismatchVisibleRef.current = v;
    setPillMismatchVisible(v);
    // Sync with ModalController (single source of truth)
    // CRITICAL: activeModalRef is updated IMMEDIATELY, modal appears on next render
    if (v) {
      activeModalRef.current = 'PILL_MISMATCH';
    } else if (activeModalRef.current === 'PILL_MISMATCH') {
      activeModalRef.current = null;
    }
  };

  // NEW: Show next alarm from queue
  // MODAL PRIORITY: Alarm modal has highest priority - uses ModalController to ensure no overlaps
  const showNextAlarmFromQueue = () => {
    if (alarmQueueRef.current.length === 0) {
      console.log('[GlobalAlarmHandler] 🔔 Alarm queue is empty');
      return;
    }

    // CRITICAL: Prevent duplicate modals - check if alarm is already visible
    if (alarmVisibleRef.current || activeModalRef.current === 'ALARM') {
      console.log('[GlobalAlarmHandler] ⏳ Alarm modal already visible, skipping duplicate show');
      // Just update remaining count if modal is already showing
      setRemainingAlarms(alarmQueueRef.current.length);
      return;
    }

    // MODAL CONTROLLER: Try to show alarm modal (will block if mismatch is showing)
    // SYNCHRONOUS: State change happens immediately, no delays
    if (!modalController.tryShowAlarm()) {
      console.log('[GlobalAlarmHandler] ⏳ Alarm modal blocked by ModalController (lock active)');
      return;
    }

    const nextAlarm = alarmQueueRef.current.shift()!;
    console.log(`[GlobalAlarmHandler] 🔔 Showing next alarm from queue: Container ${nextAlarm.container} at ${nextAlarm.time}`);
    console.log(`[GlobalAlarmHandler] 🔔 Remaining in queue: ${alarmQueueRef.current.length}`);

    // Show modal INSTANTLY - no delays
    // ModalController has already set activeModalRef, so we just sync React state
    setAlarmContainerSafe(nextAlarm.container);
    setAlarmTime(nextAlarm.time);
    setAlarmVisibleSafe(true);
    setRemainingAlarms(alarmQueueRef.current.length);
    alarmSessionActiveRef.current = true;
    lastAlarmKeyRef.current = nextAlarm.key;
    lastAlarmShownAtRef.current = nextAlarm.ts;

    // Check if alarm matches a scheduled medication time (non-blocking)
    checkIfScheduled(nextAlarm.container, nextAlarm.time).then((isScheduled) => {
      setAlarmIsScheduled(isScheduled);
      if (isScheduled) {
        console.log(`[GlobalAlarmHandler] ✅ Alarm matches scheduled medication: Container ${nextAlarm.container} at ${nextAlarm.time}`);
      } else {
        console.log(`[GlobalAlarmHandler] ℹ️ Alarm does not match any scheduled medication: Container ${nextAlarm.container} at ${nextAlarm.time}`);
      }
    }).catch((err) => {
      console.warn('[GlobalAlarmHandler] Error checking if scheduled:', err);
      setAlarmIsScheduled(false);
    });

    // GRACE PERIOD: Record alarm trigger timestamp for 1-minute visibility grace period
    // This ensures the schedule remains visible for 60 seconds even after being marked as TAKEN
    // 
    // CRITICAL: We record with today's date to match schedule dates, but also support date-less lookup
    // The alarmTriggerTracker.isWithinGracePeriod() function handles both cases
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
    alarmTriggerTracker.recordAlarmTrigger(nextAlarm.container, nextAlarm.time, today).catch((e) => {
      console.warn('[GlobalAlarmHandler] Failed to record alarm trigger:', e);
    });
    // Also record without date as fallback (in case schedule date doesn't match)
    alarmTriggerTracker.recordAlarmTrigger(nextAlarm.container, nextAlarm.time).catch((e) => {
      console.warn('[GlobalAlarmHandler] Failed to record alarm trigger (no date):', e);
    });

    // Start phone-side alarm sound/haptics (globalized here so MonitorManageScreen doesn't duplicate it)
    soundService.initialize()
      .then(() => soundService.playAlarmSound('alarm'))
      .catch((e) => console.warn('[GlobalAlarmHandler] Failed to start alarm sound:', e));

    // Mark schedule as Active (non-blocking, runs in background)
    DeviceEventEmitter.emit('pillnow:scheduleStatus', { container: nextAlarm.container, time: nextAlarm.time, status: 'Active' });
    markScheduleActive(nextAlarm.container, nextAlarm.time).catch(() => {});

    // Trigger capture for this container (non-blocking, runs in background)
    triggerCaptureForContainer(nextAlarm.container).catch(() => {});

    // Tell Arduino which container to light up (non-blocking)
    // IOT COMMUNICATION STABILITY: Check connection before sending to avoid timeout spam
    BluetoothService.isConnectionActive()
      .then((isConnected) => {
        if (isConnected) {
          return BluetoothService.sendCommand(`ALARMTEST${nextAlarm.container}\n`);
        } else {
          // Bluetooth not connected - silently skip (expected when Bluetooth is off)
          return false;
        }
      })
      .catch(() => {
        // Ignore errors - non-critical command
      });
  };

  // NEW: Add alarm to queue (with enhanced duplicate prevention for all containers)
  const addAlarmToQueue = (container: number, timeStr: string) => {
    // Validate container number (1, 2, or 3)
    if (container < 1 || container > 3) {
      console.warn(`[GlobalAlarmHandler] ⚠️ Invalid container number: ${container}, ignoring`);
      return false;
    }
    
    const key = `${container}|${timeStr}`;
    const now = Date.now();

    // CRITICAL: Check if alarm modal is already visible FIRST (prevents race conditions)
    // This must be checked before processedAlarms to catch rapid duplicate triggers
    if (alarmVisibleRef.current || activeModalRef.current === 'ALARM') {
      // If same container/time is showing, definitely skip
      if (alarmContainerRef.current === container && alarmTime === timeStr) {
        console.log(`[GlobalAlarmHandler] ⏳ Alarm ${key} already showing in modal, skipping duplicate`);
        return false;
      }
      // If different container/time, still check other guards before queueing
    }

    // Enhanced duplicate prevention: check if already processed recently (within 90s)
    if (processedAlarmsRef.current.has(key)) {
      console.log(`[GlobalAlarmHandler] ⏳ Alarm ${key} already processed (duplicate prevention), skipping`);
      return false;
    }

    // Check if already in queue
    const alreadyInQueue = alarmQueueRef.current.some(a => a.key === key);
    if (alreadyInQueue) {
      console.log(`[GlobalAlarmHandler] ⏳ Alarm ${key} already in queue, skipping`);
      return false;
    }

    // HEAVY SCHEDULING SAFETY: Prevent queue from growing unbounded
    if (alarmQueueRef.current.length >= MAX_QUEUE_SIZE) {
      console.warn(`[GlobalAlarmHandler] ⚠️ Alarm queue full (${MAX_QUEUE_SIZE} alarms), dropping oldest alarm`);
      const dropped = alarmQueueRef.current.shift();
      if (dropped) {
        processedAlarmsRef.current.delete(dropped.key);
      }
    }

    // Check if same container has an alarm showing right now (prevent stacking)
    if (alarmVisibleRef.current && alarmContainerRef.current === container) {
      console.log(`[GlobalAlarmHandler] ⏳ Container ${container} already has alarm showing, queueing instead`);
      // Still add to queue, but don't show immediately
    }

    // Add to queue
    alarmQueueRef.current.push({ container, time: timeStr, key, ts: now });
    processedAlarmsRef.current.add(key);
    console.log(`[GlobalAlarmHandler] ➕ Added alarm to queue: Container ${container} at ${timeStr}`);
    console.log(`[GlobalAlarmHandler] 📊 Queue size: ${alarmQueueRef.current.length}`);

    // TIMER LEAK FIX: Track cleanup timer and clean up on unmount
    const cleanupTimer = setTimeout(() => {
      processedAlarmsRef.current.delete(key);
      cleanupTimersRef.current.delete(cleanupTimer as any);
    }, 180000) as any;
    cleanupTimersRef.current.add(cleanupTimer);

    return true;
  };

  const API_BASE = 'https://pillnow-database.onrender.com';

  const todayYyyyMmDd = () => {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };

  /**
   * Check if an alarm matches a scheduled medication time
   * Returns true if a matching schedule exists (regardless of status)
   */
  const checkIfScheduled = async (container: number, timeStr: string): Promise<boolean> => {
    try {
      const token = await AsyncStorage.getItem('token');
      const headers: HeadersInit = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token.trim()}`;

      const resp = await fetch(`${API_BASE}/api/medication_schedules`, { headers });
      if (!resp.ok) {
        console.warn(`[GlobalAlarmHandler] ⚠️ Failed to fetch schedules for check: ${resp.status}`);
        return false;
      }
      const data = await resp.json();
      const allSchedules = data.data || [];
      const date = todayYyyyMmDd();

      // Prefer matching today's schedule; fallback to first match if date missing.
      // CRITICAL: Use normalizeContainer to ensure consistent container matching
      const matchingSchedule =
        allSchedules.find((s: any) => String(s.date || '').slice(0, 10) === date &&
          normalizeContainer(s.container) === container &&
          String(s.time).substring(0, 5) === timeStr) ||
        allSchedules.find((s: any) =>
          normalizeContainer(s.container) === container && String(s.time).substring(0, 5) === timeStr);

      return !!matchingSchedule;
    } catch (err) {
      console.error(`[GlobalAlarmHandler] ❌ Error checking if scheduled:`, err);
      return false;
    }
  };

  const markScheduleActive = async (container: number, timeStr: string) => {
    try {
      console.log(`[GlobalAlarmHandler] 📝 Marking schedule as Active: Container ${container} at ${timeStr}`);
      const token = await AsyncStorage.getItem('token');
      const headers: HeadersInit = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token.trim()}`;

      const resp = await fetch(`${API_BASE}/api/medication_schedules`, { headers });
      if (!resp.ok) {
        console.warn(`[GlobalAlarmHandler] ⚠️ Failed to fetch schedules: ${resp.status}`);
        return;
      }
      const data = await resp.json();
      const allSchedules = data.data || [];
      const date = todayYyyyMmDd();

      console.log(`[GlobalAlarmHandler] 🔍 Searching for schedule: Container ${container}, Date ${date}, Time ${timeStr}`);
      console.log(`[GlobalAlarmHandler] 📊 Total schedules: ${allSchedules.length}`);

      // Prefer matching today's schedule; fallback to first match if date missing.
      // CRITICAL: Use normalizeContainer to ensure consistent container matching
      const matchingSchedule =
        allSchedules.find((s: any) => String(s.date || '').slice(0, 10) === date &&
          normalizeContainer(s.container) === container &&
          String(s.time).substring(0, 5) === timeStr) ||
        allSchedules.find((s: any) =>
          normalizeContainer(s.container) === container && String(s.time).substring(0, 5) === timeStr);

      if (!matchingSchedule) {
        console.warn(`[GlobalAlarmHandler] ⚠️ No matching schedule found for Container ${container} at ${timeStr}`);
        return;
      }

      const currentStatus = String(matchingSchedule.status || 'Pending');
      if (currentStatus === 'Done' || currentStatus === 'Taken') {
        console.log(`[GlobalAlarmHandler] ⏳ Schedule already ${currentStatus}, skipping`);
        return;
      }

      console.log(`[GlobalAlarmHandler] ✅ Found schedule ${matchingSchedule._id}, updating to Active...`);
      const updateResp = await fetch(`${API_BASE}/api/medication_schedules/${matchingSchedule._id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ status: 'Active' }),
      });
      
      if (updateResp.ok) {
        console.log(`[GlobalAlarmHandler] ✅ Schedule ${matchingSchedule._id} marked as Active`);
      } else {
        const errorText = await updateResp.text();
        console.warn(`[GlobalAlarmHandler] ⚠️ Failed to update schedule: ${updateResp.status} - ${errorText}`);
      }
    } catch (err) {
      console.error(`[GlobalAlarmHandler] ❌ Error marking schedule as Active:`, err);
      // non-fatal
    }
  };

  /**
   * Mark schedule as Done (Taken) INSTANTLY - synchronous, no delays
   * 
   * This function uses the scheduleStatusService which:
   * 1. Updates local cache immediately (synchronous)
   * 2. Emits event immediately (UI updates instantly)
   * 3. Stores in AsyncStorage (non-blocking)
   * 4. Syncs to backend in background (debounced)
   * 
   * This ensures status is TAKEN the moment Stop Alarm is pressed,
   * with no race conditions or delays.
   */
  const markScheduleDone = (container: number, timeStr: string): void => {
    // INSTANT update - synchronous, no async/await
    const success = markScheduleTakenInstant(container, timeStr);
    if (success) {
      console.log(`[GlobalAlarmHandler] ✅ INSTANT status update: Container ${container} at ${timeStr} → TAKEN`);
    } else {
      console.log(`[GlobalAlarmHandler] ⏳ Status update skipped (already TAKEN or in progress)`);
    }
  };

  const showMismatchForContainer = async (containerNum: number) => {
    // Validate container number (1, 2, or 3)
    if (containerNum < 1 || containerNum > 3) {
      console.warn(`[GlobalAlarmHandler] ⚠️ Invalid container number: ${containerNum}, ignoring mismatch`);
      return;
    }
    
    const now = Date.now();
    
    // HARD GUARD #1: Prevent duplicate triggers from multiple sources (Bluetooth + HTTP polling)
    // Generate a temporary mismatch ID based on container and current time (will be replaced with verification timestamp)
    const tempMismatchId = `${containerNum}|${now}`;
    
    // MODAL CONTROLLER: Try to show mismatch modal (will be blocked if alarm is showing)
    // This is the PRIMARY guard - ModalController enforces priority (alarm > mismatch)
    // SYNCHRONOUS: State change happens immediately, no delays
    if (!modalController.tryShowMismatch()) {
      console.log(`[GlobalAlarmHandler] ⏳ Mismatch modal blocked by ModalController (alarm has priority or lock active)`);
      return;
    }
    
    // Enhanced global cooldown to prevent stacking modals (15 seconds)
    // This is a secondary guard for rapid-fire triggers
    if (now - lastMismatchShownAtRef.current < 15000) {
      console.log(`[GlobalAlarmHandler] ⏳ Global mismatch cooldown active (${Math.round((15000 - (now - lastMismatchShownAtRef.current)) / 1000)}s remaining), skipping`);
      // Release the lock since we're not showing
      modalController.closeMismatch();
      return;
    }
    
    // Enhanced per-container cooldown to prevent duplicate mismatch modals (90 seconds)
    const lastByContainer = lastMismatchByContainerRef.current.get(containerNum);
    if (lastByContainer && now - lastByContainer.shownAt < 90000) {
      const remaining = Math.round((90000 - (now - lastByContainer.shownAt)) / 1000);
      console.log(`[GlobalAlarmHandler] ⏳ Container ${containerNum} mismatch cooldown active (${remaining}s remaining), skipping duplicate`);
      modalController.closeMismatch();
      return;
    }

    // HARD GUARD #2: Prevent race conditions - if multiple PILLALERTs arrive quickly, only allow one
    // mismatch verification/modal flow per container at a time.
    if (mismatchInFlightRef.current.has(containerNum)) {
      console.log(`[GlobalAlarmHandler] ⏳ Mismatch verification already in flight for container ${containerNum}, skipping duplicate trigger`);
      modalController.closeMismatch();
      return;
    }
    mismatchInFlightRef.current.add(containerNum);

    const containerId = `container${containerNum}`;
    console.log(`[GlobalAlarmHandler] 🔍 Fetching verification result for ${containerId}...`);
    
    try {
      const result = await verificationService.getVerificationResult(containerId);
      
      // CRITICAL: Check detection source FIRST - phone camera should NEVER trigger mismatch modal or buzzer
      // This check happens BEFORE any other processing to ensure phone camera results are completely blocked
      const detectionSource = (result as any)?.source || (result as any)?.result?.source || 'esp32';
      const isPhoneCamera = detectionSource === 'phone';
      
      if (isPhoneCamera) {
        // PHONE CAMERA DETECTION: Informational only - block mismatch modal and buzzer
        // Phone camera detection should never be associated with container logic or trigger alerts
        console.log(`[GlobalAlarmHandler] 📱 Phone camera detection for Container ${containerNum} - informational only (no mismatch modal, no buzzer, no container logic)`);
        mismatchInFlightRef.current.delete(containerNum);
        modalController.closeMismatch();
        return;
      }
      
      const verificationTs = (result as any)?.timestamp ? String((result as any).timestamp) : undefined;
      
      // HARD GUARD #3: Generate unique mismatch ID from verification timestamp or fallback to current time
      // This ensures each distinct mismatch event is handled only once, even if triggered from multiple sources
      const mismatchId = verificationTs 
        ? `${containerNum}|${verificationTs}` 
        : `${containerNum}|${now}`;
      
      // CRITICAL: Check if this exact mismatch has already been handled
      // This prevents duplicates from Bluetooth + HTTP polling triggering the same mismatch
      if (handledMismatchIdsRef.current.has(mismatchId)) {
        console.log(`[GlobalAlarmHandler] 🛡️ HARD GUARD: Mismatch ${mismatchId} already handled, blocking duplicate`);
        mismatchInFlightRef.current.delete(containerNum);
        modalController.closeMismatch();
        return;
      }
      
      // If we already showed a mismatch for this exact verification result, don't show again.
      if (verificationTs && lastByContainer?.verificationTs === verificationTs) {
        console.log(`[GlobalAlarmHandler] ⏳ Already showed mismatch for this verification timestamp, skipping`);
        mismatchInFlightRef.current.delete(containerNum);
        modalController.closeMismatch();
        return;
      }

      // ESP32-CAM DETECTION: Process mismatch (safety behavior)
      // At this point, we know it's ESP32-CAM (phone camera blocked above)
      if (result.success && result.result && result.result.pass_ === false) {
        // Extract expected label and count from various possible locations
        const expectedLabel =
          (result as any).result?.expectedLabel ||
          (result as any).result?.expected?.label ||
          (result as any).expected?.label ||
          'unknown';
        
        const expectedCount = 
          (result as any).result?.expected?.count ||
          (result as any).expected?.count ||
          (result as any).result?.expectedCount ||
          0;
        
        // Extract detected classes with counts
        const classesDetected = (result as any).result?.classesDetected || [];
        const detectedLabels = classesDetected.length > 0
          ? classesDetected.map((c: any) => `${c.label} (${c.n})`).join(', ')
          : 'none';
        const detectedCount = (result as any).result?.count || 0;
        
        // Check if KNN detected foreign pills
        const knnData = (result as any).result?.knnVerification;
        const foreignPillsDetected = knnData?.foreign_pills_detected || (result as any).result?.foreignPillsDetected || false;
        const foreignPillLabels = knnData?.foreign_pill_labels || (result as any).result?.foreignPillLabels || [];
        
        console.log(`[GlobalAlarmHandler] 🚨 MISMATCH DETAILS:`);
        console.log(`   Expected: ${expectedCount > 0 ? `${expectedCount} x ` : ''}${expectedLabel}`);
        console.log(`   Detected: ${detectedLabels} (${detectedCount} pills)`);
        if (expectedCount > 0 && detectedCount !== expectedCount) {
          console.log(`   ⚠️ COUNT MISMATCH: Expected ${expectedCount}, found ${detectedCount}`);
        }
        if (foreignPillsDetected) {
          console.log(`   ⚠️ FOREIGN PILLS DETECTED: ${foreignPillLabels.join(', ')}`);
        }
        if (knnData) {
          console.log(`   KNN verified: ${knnData.total_verified}, Foreign pills: ${knnData.foreign_pills_detected}`);
        }

        // HARD GUARD #4: Mark this mismatch as handled BEFORE showing modal
        // This prevents duplicate modals if the same mismatch is triggered again
        handledMismatchIdsRef.current.add(mismatchId);
        lastMismatchIdRef.current = mismatchId;
        
        // Clean up old handled mismatch IDs (keep only last 10 to prevent memory leak)
        if (handledMismatchIdsRef.current.size > 10) {
          const idsArray = Array.from(handledMismatchIdsRef.current);
          handledMismatchIdsRef.current = new Set(idsArray.slice(-10));
        }
        
        // Set mismatch data and show modal
        // ModalController has already set activeModalRef, so we just sync React state
        setPillMismatchContainer(containerNum);
        setPillMismatchExpected(expectedLabel);
        setPillMismatchDetected(detectedLabels);
        setPillMismatchCount(detectedCount);
        setPillMismatchExpectedCount(expectedCount);
        setPillMismatchForeignPills(foreignPillsDetected);
        setPillMismatchForeignLabels(foreignPillLabels);
        setPillMismatchVisibleSafe(true);
        lastMismatchShownAtRef.current = now;
        lastMismatchByContainerRef.current.set(containerNum, { shownAt: now, verificationTs });
        
        // Clear in-flight flag since we've successfully shown the modal
        mismatchInFlightRef.current.delete(containerNum);
        
        console.log(`[GlobalAlarmHandler] ✅ Mismatch modal shown for Container ${containerNum} (ID: ${mismatchId})`);

        // Local notification for pill mismatch
        try {
          // @ts-expect-error - lazy import
          const Notifications = await import('expo-notifications');
          if (Notifications.default?.scheduleNotificationAsync) {
            await Notifications.default.scheduleNotificationAsync({
              content: {
                title: '⚠️ Pill Mismatch Detected',
                body: `Container ${containerNum}: expected ${expectedLabel}, detected ${detectedLabels}`,
                sound: 'default',
                data: { type: 'pill_mismatch', container: containerNum },
              },
              trigger: null,
            });
          }
        } catch (e) {
          console.warn('[GlobalAlarmHandler] Mismatch notification failed:', e);
        }
        return;
      } else {
        // Verification passed or no mismatch detected - clear in-flight flag and close modal
        console.log(`[GlobalAlarmHandler] Verification result: pass_=${result.result?.pass_}, success=${result.success} - no mismatch`);
        mismatchInFlightRef.current.delete(containerNum);
        modalController.closeMismatch();
        return;
      }

      // Fallback generic modal if verification isn't available yet
      // HARD GUARD: Mark this mismatch as handled even for fallback
      handledMismatchIdsRef.current.add(mismatchId);
      lastMismatchIdRef.current = mismatchId;
      
      // Clean up old handled mismatch IDs
      if (handledMismatchIdsRef.current.size > 10) {
        const idsArray = Array.from(handledMismatchIdsRef.current);
        handledMismatchIdsRef.current = new Set(idsArray.slice(-10));
      }
      
      // ModalController check already passed above, so we can show
      console.log(`[GlobalAlarmHandler] ⚠️ Showing fallback mismatch modal (no detailed verification available, ID: ${mismatchId})`);
      setPillMismatchContainer(containerNum);
      setPillMismatchExpected('unknown');
      setPillMismatchDetected('Mismatch detected');
      setPillMismatchCount(0);
      setPillMismatchExpectedCount(0);
      setPillMismatchForeignPills(false);
      setPillMismatchForeignLabels([]);
      setPillMismatchVisibleSafe(true);
      lastMismatchShownAtRef.current = now;
      lastMismatchByContainerRef.current.set(containerNum, { shownAt: now, verificationTs });
      
      // Clear in-flight flag
      mismatchInFlightRef.current.delete(containerNum);
    } catch (err) {
      // Error fetching verification - clear in-flight flag and close modal
      console.warn(`[GlobalAlarmHandler] ⚠️ Error fetching verification for container ${containerNum}:`, err);
      mismatchInFlightRef.current.delete(containerNum);
      modalController.closeMismatch();
    }
  };

  const [alarmVerification, setAlarmVerification] = useState<any | null>(null);
  const stopInFlightRef = useRef<boolean>(false);

  const triggerCaptureForContainer = async (containerNum: number) => {
    // Validate container number (1, 2, or 3)
    if (containerNum < 1 || containerNum > 3) {
      console.warn(`[GlobalAlarmHandler] ⚠️ Invalid container number: ${containerNum}, cannot trigger capture`);
      return;
    }
    
    const containerId = `container${containerNum}`;
    console.log(`[GlobalAlarmHandler] 📸 Triggering PRE/POST alarm capture for ${containerId}...`);
    
    // We try to include expected config from backend; if it fails, capture still triggers.
    try {
      // Use verificationService.getBackendUrl (supports runtime override) instead of hardcoded IP
      const base = await verificationService.getBackendUrl();
      const cfgResp = await fetch(`${base}/get-pill-config/${containerId}`);
      if (cfgResp.ok) {
        const cfg = await cfgResp.json();
        const expected = cfg?.pill_config || { count: 0 };
        
        // Log what we're sending for verification debugging
        console.log(`[GlobalAlarmHandler] 📊 Expected config for ${containerId}: count=${expected.count}, label=${expected.label || 'none'}`);
        
        const result = await verificationService.triggerCapture(containerId, expected);
        if (result.ok) {
          console.log(`[GlobalAlarmHandler] ✅ Capture triggered successfully for ${containerId}`);
        } else {
          console.warn(`[GlobalAlarmHandler] ⚠️ Capture trigger returned error for ${containerId}: ${result.message}`);
        }
        return;
      }
    } catch (err) {
      console.warn(`[GlobalAlarmHandler] Failed to get pill config for ${containerId}:`, err);
    }
    
    console.log(`[GlobalAlarmHandler] 📸 Triggering capture for ${containerId} with default config (count=0)`);
    const result = await verificationService.triggerCapture(containerId, { count: 0 });
    if (result.ok) {
      console.log(`[GlobalAlarmHandler] ✅ Capture triggered successfully for ${containerId} (default config)`);
    }
  };

  // Triggers a capture and polls for verification result, returning a structured object for the modal
  const fetchVerificationAfterCapture = async (containerNum: number, timeoutMs = 20000) => {
    // CRITICAL: Don't fetch verification if user stopped the alarm
    // This prevents the modal from showing again with verification results
    if (alarmStoppedByUserRef.current) {
      console.log('[GlobalAlarmHandler] 🛑 Alarm stopped by user - skipping verification fetch');
      return null;
    }
    
    if (stopInFlightRef.current) {
      console.log(`[GlobalAlarmHandler] ⏳ Stop already in flight for container ${containerNum}, reusing existing operation`);
      return null;
    }
    stopInFlightRef.current = true;
    setAlarmVerification(null);

    const containerId = `container${containerNum}`;
    try {
      // Prefer to ask the backend to perform a post-stop capture. This centralizes capture requests
      // (Arduino bridge will also call backend /alarm/stopped on hardware stops) and avoids duplicate
      // publishes from both the app and the bridge. If backend call fails or is rate-limited, fall back
      // to triggering a direct capture via `triggerCapture`.
      try {
        const base = await verificationService.getBackendUrl();
        console.log(`[GlobalAlarmHandler] 🛑 Requesting backend post-stop capture for ${containerId}`);
        const stopResp = await fetch(`${base}/alarm/stopped/${containerId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ capture: true }),
        });

        if (stopResp.ok) {
          const body = await stopResp.json().catch(() => ({}));
          if (body && body.captureRequested) {
            console.log(`[GlobalAlarmHandler] ✅ Backend accepted post-stop capture for ${containerId}`);
            // Backend will publish capture; proceed to polling below
          } else {
            console.log(`[GlobalAlarmHandler] ⚠️ Backend did not request capture (captureRequested=${body?.captureRequested}), falling back to direct trigger`);
            // fallback to direct trigger
            try {
              const cfgResp = await fetch(`${base}/get-pill-config/${containerId}`);
              if (cfgResp.ok) {
                const cfg = await cfgResp.json();
                const expected = cfg?.pill_config || { count: 0 };
                await verificationService.triggerCapture(containerId, expected);
              } else {
                await verificationService.triggerCapture(containerId, { count: 0 });
              }
            } catch (err) {
              console.warn('[GlobalAlarmHandler] Fetch config failed, triggering with default', err);
              await verificationService.triggerCapture(containerId, { count: 0 });
            }
          }
        } else {
          // Rate limited or server error -> fallback
          console.warn(`[GlobalAlarmHandler] Backend /alarm/stopped returned ${stopResp.status}, falling back to triggerCapture`);
          try {
            const cfgResp = await fetch(`${base}/get-pill-config/${containerId}`);
            if (cfgResp.ok) {
              const cfg = await cfgResp.json();
              const expected = cfg?.pill_config || { count: 0 };
              await verificationService.triggerCapture(containerId, expected);
            } else {
              await verificationService.triggerCapture(containerId, { count: 0 });
            }
          } catch (err) {
            console.warn('[GlobalAlarmHandler] Fetch config failed, triggering with default', err);
            await verificationService.triggerCapture(containerId, { count: 0 });
          }
        }
      } catch (err) {
        console.warn('[GlobalAlarmHandler] Failed to call /alarm/stopped, falling back to direct trigger', err);
        try {
          const base = await verificationService.getBackendUrl();
          const cfgResp = await fetch(`${base}/get-pill-config/${containerId}`);
          if (cfgResp.ok) {
            const cfg = await cfgResp.json();
            const expected = cfg?.pill_config || { count: 0 };
            await verificationService.triggerCapture(containerId, expected);
          } else {
            await verificationService.triggerCapture(containerId, { count: 0 });
          }
        } catch (err2) {
          console.warn('[GlobalAlarmHandler] Fetch config failed, triggering with default', err2);
          await verificationService.triggerCapture(containerId, { count: 0 });
        }
      }

      // Poll for verification result with proper timeout handling
      const start = Date.now();
      const pollInterval = 2000; // 2 seconds
      while (Date.now() - start < timeoutMs) {
        // CRITICAL: Check if user stopped alarm during polling - exit immediately
        if (alarmStoppedByUserRef.current) {
          console.log('[GlobalAlarmHandler] 🛑 Alarm stopped by user during verification polling - aborting');
          stopInFlightRef.current = false;
          return null;
        }
        
        try {
          const result = await verificationService.getVerificationResult(containerId);
          if (result && result.success && result.result) {
            // CRITICAL: Double-check if user stopped alarm before setting verification
            // This prevents the modal from showing again
            if (alarmStoppedByUserRef.current) {
              console.log('[GlobalAlarmHandler] 🛑 Alarm stopped by user - not setting verification state');
              stopInFlightRef.current = false;
              return null;
            }
            
            const base = await verificationService.getBackendUrl();
            const annotated = (result as any)?.result?.annotatedImagePath || (result as any)?.annotatedImagePath || null;
            const annotatedUrl = annotated ? (annotated.startsWith('http') ? annotated : `${base}${annotated}`) : null;
            const verification = { success: result.success, result: result.result, annotatedUrl };
            setAlarmVerification(verification);
            console.log('[GlobalAlarmHandler] ✅ Verification obtained:', verification);
            stopInFlightRef.current = false;
            return verification;
          }
        } catch (err) {
          console.warn('[GlobalAlarmHandler] getVerificationResult polling error:', err);
        }
        // TIMER LEAK FIX: Use tracked timeout with proper cleanup
        const pollTimer = new Promise<void>((r) => {
          const timer = setTimeout(r, pollInterval) as any;
          cleanupTimersRef.current.add(timer);
        });
        // eslint-disable-next-line no-await-in-loop
        await pollTimer;
      }

      // timeout
      console.warn('[GlobalAlarmHandler] ⚠️ Verification polling timed out');
      stopInFlightRef.current = false;
      return { success: false, message: 'timeout', annotatedUrl: null };
    } finally {
      stopInFlightRef.current = false;
    }
  };

  useEffect(() => {
    let active = true;
    let httpPollTimer: any = null;
    let lastPollTimestamp = Date.now();
    let pollBackoffMs = 2000; // start aggressive, back off on failure
    let consecutiveHttpPollFailures = 0;
    let lastHttpPollErrorLogAt = 0;
    let clearedBackendOverride = false;

    // If Bluetooth is not connected, we still keep handler mounted; it will just not receive.
    BluetoothService.isConnectionActive().then(async (isConnected) => {
      if (!isConnected) {
        console.warn('[GlobalAlarmHandler] Bluetooth not connected; using HTTP polling as fallback for alarms/mismatch modals.');
        
        // Start HTTP polling as fallback when Bluetooth unavailable
        const pollAlarmEvents = async () => {
          if (!active) return;
          try {
            const base = await verificationService.getBackendUrl();
            // Helpful trace so we can see what base URL the app is trying to reach
            // (this is often the root cause when IP changes)
            // eslint-disable-next-line no-console
            console.log(`[GlobalAlarmHandler] HTTP polling → ${base}/alarm-events?since=${lastPollTimestamp}`);
            const response = await fetch(`${base}/alarm-events?since=${lastPollTimestamp}`);
            if (!response.ok) {
              // Treat non-200 as a failure so the self-heal can clear stale backend overrides.
              throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            if (data.events && Array.isArray(data.events)) {
              for (const event of data.events) {
                if (event.timestamp > lastPollTimestamp) {
                  lastPollTimestamp = event.timestamp;
                }
                
                if (event.type === 'alarm_triggered') {
                  // CRITICAL: Use normalizeContainer to prevent data mixing
                  const containerNum = normalizeContainer(event.container);
                  const timeStr = event.time || '00:00';
                  console.log(`[GlobalAlarmHandler] 📨 HTTP Poll: ALARM_TRIGGERED for Container ${containerNum} at ${timeStr}`);
                  
                  // Process alarm same as Bluetooth message
                  // MODAL PRIORITY: Alarm has priority - close mismatch if showing
                  if (pillMismatchVisibleRef.current) {
                    modalController.closeMismatch();
                    setPillMismatchVisibleSafe(false);
                  }
                  
                  const wasAdded = addAlarmToQueue(containerNum, timeStr);
                  if (wasAdded && !alarmVisibleRef.current) {
                    showNextAlarmFromQueue();
                  }
                } else if (event.type === 'pill_mismatch') {
                  // CRITICAL: Use normalizeContainer to prevent data mixing
                  const containerNum = normalizeContainer(event.container || 'container1');
                  console.log(`[GlobalAlarmHandler] 📨 HTTP Poll: PILLALERT for Container ${containerNum}`);
                  
                  if (alarmVisibleRef.current) {
                    pendingMismatchRef.current = { container: containerNum, ts: Date.now() };
                    console.log(`[GlobalAlarmHandler] ⏳ HTTP Poll: Alarm active, queuing mismatch for Container ${containerNum}`);
                  } else {
                    // All triggers go through the same centralized function with hard guards
                    console.log(`[GlobalAlarmHandler] 📨 HTTP Poll: Triggering mismatch for Container ${containerNum}`);
                    showMismatchForContainer(containerNum).catch((err) => {
                      console.warn(`[GlobalAlarmHandler] Error showing mismatch from HTTP poll trigger:`, err);
                    });
                  }
                }
              }
            }

            // Success: reset backoff
            consecutiveHttpPollFailures = 0;
            pollBackoffMs = 2000;
          } catch (err) {
            consecutiveHttpPollFailures += 1;

            // Backoff up to 30s to avoid log spam and battery drain when backend is unreachable
            pollBackoffMs = Math.min(30000, pollBackoffMs * 2);

            // Self-heal: if we are polling a stale backend override (common when IP changes),
            // clear it once after a couple failures so we fall back to the default BACKEND_URL.
            // This avoids getting stuck polling a dead IP like 10.x.x.x forever.
            if (!clearedBackendOverride && consecutiveHttpPollFailures >= 2) {
              try {
                const override = await AsyncStorage.getItem('backend_url_override');
                if (override && String(override).trim()) {
                  console.warn(`[GlobalAlarmHandler] Clearing stale backend_url_override after repeated HTTP poll failures: ${override}`);
                  await AsyncStorage.removeItem('backend_url_override');
                  clearedBackendOverride = true;
                  // Reset backoff so the next poll tries the default immediately
                  pollBackoffMs = 2000;
                  consecutiveHttpPollFailures = 0;
                }
              } catch {
                // ignore
              }
            }

            // Log at most once every 10s to avoid console spam
            const now = Date.now();
            if (now - lastHttpPollErrorLogAt > 10000) {
              lastHttpPollErrorLogAt = now;
              console.warn(
                `[GlobalAlarmHandler] HTTP polling error (${consecutiveHttpPollFailures} fail(s), next in ${Math.round(pollBackoffMs / 1000)}s):`,
                err
              );
            }
          }
        };
        
        // Poll with adaptive backoff when Bluetooth unavailable
        const scheduleNext = async () => {
          if (!active) return;
          await pollAlarmEvents();
          if (!active) return;
          httpPollTimer = setTimeout(scheduleNext, pollBackoffMs);
        };
        scheduleNext(); // initial poll
      }
    });

    const cleanup = BluetoothService.onDataReceived(async (data: string) => {
      if (!active) return;

      const trimmed = (data || '').trim();
      if (!trimmed) return;

      // --- Alarm triggered ---
      if (trimmed.toUpperCase().includes('ALARM_TRIGGERED')) {
        // Supports:
        // - ALARM_TRIGGERED C2 23:07
        // - ALARM_TRIGGERED C2 2025-12-14 23:07
        const match = trimmed.match(/ALARM_TRIGGERED\s+C(\d+)\s+(?:\d{4}-\d{2}-\d{2}\s+)?(\d{1,2}):(\d{2})/i);
        if (!match) return;
        // CRITICAL: Use normalizeContainer to prevent data mixing
        const container = normalizeContainer(match[1]);
        const timeStr = `${match[2].padStart(2, '0')}:${match[3]}`;

        console.log(`[GlobalAlarmHandler] 📨 Received ALARM_TRIGGERED for Container ${container} at ${timeStr}`);

        // MODAL PRIORITY: If mismatch was queued, it will be handled by ModalController
        // No need to cancel timers - we're using state-driven logic now

        // MODAL PRIORITY: Alarm has priority - close mismatch modal if showing
        // ModalController will handle this, but we also close React state immediately
        if (pillMismatchVisibleRef.current) {
          modalController.closeMismatch();
          setPillMismatchVisibleSafe(false);
        }

        // IMPROVED: Add to queue instead of immediately showing
        // This handles multiple simultaneous alarms (e.g., 3 containers at same time)
        const wasAdded = addAlarmToQueue(container, timeStr);
        if (!wasAdded) {
          console.log(`[GlobalAlarmHandler] ⏳ Alarm was duplicate, not showing`);
          return;
        }

        // Log queue status for debugging simultaneous alarms
        const queueSize = alarmQueueRef.current.length;
        if (queueSize > 1) {
          console.log(`[GlobalAlarmHandler] 📊 MULTIPLE ALARMS IN QUEUE: ${queueSize} alarm(s) waiting`);
          console.log(`[GlobalAlarmHandler] 📋 Queue: ${alarmQueueRef.current.map(a => `Container ${a.container}@${a.time}`).join(', ')}`);
        }

        // Send local notification for ALL alarms (so user knows about all of them)
        try {
          // @ts-expect-error - lazy import
          const Notifications = await import('expo-notifications');
          if (Notifications.default?.scheduleNotificationAsync) {
            await Notifications.default.scheduleNotificationAsync({
              content: {
                title: '💊 Medication Reminder',
                body: `Time to take medication from Container ${container} (${timeStr})${queueSize > 1 ? ` (+${queueSize - 1} more)` : ''}`,
                sound: 'default',
                data: { type: 'alarm_triggered', container, time: timeStr },
              },
              trigger: null,
            });
          }
        } catch (e) {
          console.warn('[GlobalAlarmHandler] Alarm notification failed:', e);
        }

        // CRITICAL: Double-check modal state before showing to prevent duplicates
        // Check both refs to catch any race conditions between Bluetooth and HTTP polling
        const isModalCurrentlyVisible = alarmVisibleRef.current || activeModalRef.current === 'ALARM';
        
        if (!isModalCurrentlyVisible) {
          console.log(`[GlobalAlarmHandler] 🔔 Showing first alarm from queue (${queueSize} total in queue)`);
          showNextAlarmFromQueue();
        } else {
          // Modal already visible, update remaining count only
          setRemainingAlarms(queueSize);
          console.log(`[GlobalAlarmHandler] 🔔 Alarm queued (modal already visible). Queue size: ${queueSize}, remaining: ${queueSize - 1}`);
        }

        return;
      }

      // --- Alarm stopped (user pressed stop) ---
      if (trimmed.toUpperCase().includes('ALARM_STOPPED')) {
        const m = trimmed.match(/ALARM_STOPPED\s+C(\d+)/i);
        // CRITICAL: Use normalizeContainer to prevent data mixing
        const container = m ? normalizeContainer(m[1]) : alarmContainerRef.current;
        const timeStr = alarmTime; // Use current alarm time

        console.log(`[GlobalAlarmHandler] 🛑 Alarm stopped for Container ${container}`);

        // INSTANT status update when ALARM_STOPPED is received from hardware
        // This ensures status is TAKEN immediately, even if user pressed hardware button
        if (container && timeStr) {
          markScheduleDone(container, timeStr);
        }

        // Stop phone-side alarm sound/haptics immediately when hardware stop arrives
        try {
          soundService.stopSound().catch(() => {});
        } catch {
          // ignore
        }

        // CRITICAL: Close pill mismatch modal when alarm is stopped via hardware
        // This ensures mismatch modal stops displaying when alarm is stopped
        if (pillMismatchVisibleRef.current || modalController.isMismatchActive()) {
          console.log('[GlobalAlarmHandler] 🛑 Alarm stopped via hardware - closing pill mismatch modal');
          modalController.closeMismatch();
          setPillMismatchVisibleSafe(false);
          // Clear in-flight flag
          mismatchInFlightRef.current.delete(container);
          // Clear pending mismatch
          pendingMismatchRef.current = null;
        }

        // MODAL STATE MANAGER: Mismatch queuing is handled by ModalController
        // No need to cancel timers - we're using state-driven logic now

        // If a stop is already in flight (e.g., user pressed Stop inside modal and modal's onStop is handling capture), don't double-trigger
        if (stopInFlightRef.current) {
          console.log('[GlobalAlarmHandler] ⏳ Stop already in flight, skipping duplicate ALARM_STOPPED handling');
        } else if (alarmSessionActiveRef.current) {
          // Alarm was stopped - close modal immediately, don't show verification results
          alarmSessionActiveRef.current = false;

          // CRITICAL: Close modal immediately - user doesn't want to see verification results
          setAlarmVisibleSafe(false);
          setAlarmVerification(null); // Clear any verification state

          // Clear any pending mismatch to prevent it from showing after alarm is stopped
          const pending = pendingMismatchRef.current;
          pendingMismatchRef.current = null;
          if (pending && pending.container === container) {
            console.log('[GlobalAlarmHandler] ⏳ Pending mismatch cleared - alarm was stopped by user');
          }

          // Show next queued alarm if any
          // SYNCHRONOUS: Show immediately - state-driven, no delays
          if (alarmQueueRef.current.length > 0) {
            const remaining = alarmQueueRef.current.length;
            console.log(`[GlobalAlarmHandler] 🔔 More alarms in queue (${remaining} remaining), showing next immediately...`);
            showNextAlarmFromQueue();
          } else {
            console.log(`[GlobalAlarmHandler] ✅ All alarms processed - queue is empty`);
            setRemainingAlarms(0);
          }
        } else {
          // Not a schedule session; just dismiss any visible alarm UI
          // But still mark as Done if we have container/time info (INSTANT update)
          if (container && timeStr) {
            markScheduleDone(container, timeStr);
          }
          setAlarmVisibleSafe(false);
          setAlarmVerification(null); // Clear any verification state
        }

        return;
      }

      // --- Pill mismatch ---
      if (trimmed.toUpperCase().includes('PILLALERT')) {
        const m = trimmed.match(/PILLALERT\s+C(\d+)/i);
        // CRITICAL: Use normalizeContainer to prevent data mixing
        const container = m ? normalizeContainer(m[1]) : 1;

        // If alarm modal is up, queue mismatch to show after user stops alarm (prevents duplicates/stacking)
        if (alarmVisibleRef.current) {
          pendingMismatchRef.current = { container, ts: Date.now() };
          return;
        }

        // If we already showed a mismatch modal recently for this container, ignore spammy repeats.
        const lastShown = lastMismatchByContainerRef.current.get(container);
        if (lastShown && Date.now() - lastShown.shownAt < 60000) {
          console.log(`[GlobalAlarmHandler] ⏳ Bluetooth PILLALERT: Container ${container} mismatch shown recently, ignoring duplicate`);
          return;
        }

        // MODAL PRIORITY: Check if alarm is showing - if so, queue mismatch
        // NO SETTIMEOUT: Use ModalController to check state synchronously
        // This ensures mismatch is blocked if alarm is active, without delays
        if (alarmVisibleRef.current || modalController.isAlarmActive()) {
          // Alarm is active - queue mismatch to show after alarm closes
          pendingMismatchRef.current = { container, ts: Date.now() };
          console.log(`[GlobalAlarmHandler] ⏳ Bluetooth PILLALERT: Alarm active, queuing mismatch for Container ${container}`);
          return;
        }

        // No alarm active - try to show mismatch immediately
        // ModalController will block if alarm becomes active (synchronous check)
        // All triggers go through the same centralized function with hard guards
        console.log(`[GlobalAlarmHandler] 📨 Bluetooth PILLALERT: Triggering mismatch for Container ${container}`);
        showMismatchForContainer(container).catch((err) => {
          console.warn(`[GlobalAlarmHandler] Error showing mismatch from Bluetooth trigger:`, err);
        });
        return;
      }
    });

    return () => {
      active = false;
      if (httpPollTimer) {
        clearTimeout(httpPollTimer);
        httpPollTimer = null;
      }
      // TIMER LEAK FIX: Clean up all tracked cleanup timers
      cleanupTimersRef.current.forEach(timer => {
        clearTimeout(timer);
      });
      cleanupTimersRef.current.clear();
      // MODAL STATE MANAGER: Clean up all modals on unmount
      modalController.closeAll();
      try {
        cleanup?.();
      } catch {
        // ignore
      }
    };
    // We intentionally do NOT depend on alarmVisible/pillMismatchVisible to avoid re-registering listeners
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // MODAL CONTROLLER: Single source of truth for modal visibility
  // CRITICAL: Visibility is derived DIRECTLY from ModalController ref (synchronous, no delays)
  // This ensures modals appear instantly without waiting for React state updates or render cycles
  // Priority: ALARM > PILL_MISMATCH (enforced by ModalController)
  const activeModal = activeModalRef.current;
  const shouldShowAlarm = activeModal === 'ALARM';
  const shouldShowMismatch = activeModal === 'PILL_MISMATCH';
  
  // CRITICAL: Sync React state with ModalController state using useEffect to avoid render-time state updates
  // This ensures React state matches, but modal visibility is driven by ref for instant display
  useEffect(() => {
    if (shouldShowAlarm !== alarmVisible) {
      alarmVisibleRef.current = shouldShowAlarm;
      setAlarmVisible(shouldShowAlarm);
    }
    if (shouldShowMismatch !== pillMismatchVisible) {
      pillMismatchVisibleRef.current = shouldShowMismatch;
      setPillMismatchVisible(shouldShowMismatch);
    }
  }, [shouldShowAlarm, shouldShowMismatch, alarmVisible, pillMismatchVisible]);

  return (
    <>
      <AlarmModal
        visible={shouldShowAlarm}
        container={alarmContainer}
        time={alarmTime}
        remainingAlarms={remainingAlarms}
        isScheduled={alarmIsScheduled}
        onDismiss={() => {
          // INSTANT status update when alarm is dismissed (e.g., via Dismiss button)
          // This ensures status is TAKEN even if Stop Alarm wasn't pressed
          if (alarmContainerRef.current && alarmTime) {
            markScheduleDone(alarmContainerRef.current, alarmTime);
          }
          // MODAL STATE MANAGER: Close alarm modal and reset state
          modalController.closeAlarm();
          setAlarmVisibleSafe(false);
          setAlarmVerification(null); // Clear verification state to prevent modal from showing again
          setAlarmIsScheduled(false); // Reset scheduled flag
          
          // CRITICAL: Close pill mismatch modal when alarm is dismissed
          // This ensures mismatch modal stops displaying when alarm is closed
          if (pillMismatchVisibleRef.current || modalController.isMismatchActive()) {
            console.log('[GlobalAlarmHandler] 🛑 Alarm dismissed - closing pill mismatch modal');
            modalController.closeMismatch();
            setPillMismatchVisibleSafe(false);
            // Clear in-flight flag
            mismatchInFlightRef.current.delete(pillMismatchContainer);
            // Clear pending mismatch
            pendingMismatchRef.current = null;
          }
          
          // CRITICAL: Only show next alarm if user didn't explicitly stop the alarm
          // When user clicks "Stop Alarm", they want to stop, not move to next alarm
          const wasStoppedByUser = alarmStoppedByUserRef.current;
          alarmStoppedByUserRef.current = false; // Reset flag
          
          if (!wasStoppedByUser && alarmQueueRef.current.length > 0) {
            console.log('[GlobalAlarmHandler] 🔔 Showing next alarm from queue (user dismissed, not stopped)');
            showNextAlarmFromQueue();
          } else if (wasStoppedByUser) {
            console.log('[GlobalAlarmHandler] 🛑 Alarm stopped by user - NOT showing next alarm from queue');
          }
        }}
        onStopImmediate={() => {
          // CRITICAL: Mark that user explicitly stopped the alarm
          // This prevents showing the next alarm from queue when onDismiss is called
          alarmStoppedByUserRef.current = true;
          
          // CRITICAL: Clear verification state immediately to prevent modal from showing again
          // When user stops alarm, they don't want to see verification results
          setAlarmVerification(null);
          
          // INSTANT status update - synchronous, happens BEFORE modal closes
          // This is called the moment "Stop Alarm" is pressed
          if (alarmContainerRef.current && alarmTime) {
            markScheduleDone(alarmContainerRef.current, alarmTime);
            // Event is already emitted by markScheduleDone, but emit again for immediate UI feedback
            DeviceEventEmitter.emit('pillnow:scheduleStatus', {
              container: alarmContainerRef.current,
              time: alarmTime,
              status: 'Done',
            });
          }
          
          // CRITICAL: Close pill mismatch modal INSTANTLY when Stop Alarm is pressed
          // This ensures mismatch modal stops displaying immediately
          if (pillMismatchVisibleRef.current || modalController.isMismatchActive()) {
            console.log('[GlobalAlarmHandler] 🛑 Stop Alarm pressed - closing pill mismatch modal');
            modalController.closeMismatch();
            setPillMismatchVisibleSafe(false);
            // Clear in-flight flag
            mismatchInFlightRef.current.delete(pillMismatchContainer);
            // Clear pending mismatch
            pendingMismatchRef.current = null;
          }
        }}
        onStop={async (containerNum: number) => {
          // CRITICAL: Don't run verification when user stops the alarm
          // User wants the modal to close immediately, not see verification results
          // Always return null to prevent verification modal from showing
          console.log('[GlobalAlarmHandler] 🛑 Alarm stopped by user - skipping verification');
          return null;
        }}
        externalVerification={alarmVerification}
      />

      <PillMismatchModal
        visible={shouldShowMismatch}
        container={pillMismatchContainer}
        expectedLabel={pillMismatchExpected}
        detectedLabels={pillMismatchDetected}
        detectedCount={pillMismatchCount}
        expectedCount={pillMismatchExpectedCount}
        foreignPillsDetected={pillMismatchForeignPills}
        foreignPillLabels={pillMismatchForeignLabels}
        onDismiss={() => {
          // MODAL CONTROLLER: Close mismatch modal and reset state
          // NOTE: handledMismatchIdsRef is NOT cleared here - it prevents reopening the same mismatch
          // The guard is reset only when a NEW distinct mismatch occurs (different ID)
          modalController.closeMismatch();
          setPillMismatchVisibleSafe(false);
          
          // Clear in-flight flag when modal is dismissed
          mismatchInFlightRef.current.delete(pillMismatchContainer);
          
          console.log(`[GlobalAlarmHandler] ✅ Mismatch modal dismissed for Container ${pillMismatchContainer}`);
        }}
      />
    </>
  );
}


