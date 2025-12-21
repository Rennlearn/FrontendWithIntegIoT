import React, { useEffect, useRef, useState } from 'react';
import { Alert, DeviceEventEmitter } from 'react-native';
import BluetoothService from '@/services/BluetoothService';
import AlarmModal from '@/components/AlarmModal';
import PillMismatchModal from './PillMismatchModal';
import verificationService from '@/services/verificationService';
import AsyncStorage from '@react-native-async-storage/async-storage';

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
export default function GlobalAlarmHandler() {
  const [alarmVisible, setAlarmVisible] = useState(false);
  const [alarmContainer, setAlarmContainer] = useState(1);
  const [alarmTime, setAlarmTime] = useState('00:00');
  
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

  // IMPROVED: Alarm queue for multiple simultaneous alarms
  const alarmQueueRef = useRef<AlarmQueueItem[]>([]);
  const processedAlarmsRef = useRef<Set<string>>(new Set()); // track shown alarms to prevent duplicates

  const lastAlarmKeyRef = useRef<string>('');
  const lastAlarmShownAtRef = useRef<number>(0);
  const lastMismatchShownAtRef = useRef<number>(0);
  const lastMismatchByContainerRef = useRef<Map<number, { shownAt: number; verificationTs?: string }>>(new Map());
  const mismatchInFlightRef = useRef<Set<number>>(new Set());
  const pendingMismatchRef = useRef<PendingMismatch | null>(null);
  const pendingMismatchTimerRef = useRef<any>(null);
  const pendingMismatchCandidateRef = useRef<number | null>(null); // container waiting to show mismatch (race with alarm)

  // IMPORTANT: onDataReceived callback is registered once; use refs to avoid stale state.
  const alarmVisibleRef = useRef<boolean>(false);
  const alarmContainerRef = useRef<number>(1);
  const pillMismatchVisibleRef = useRef<boolean>(false);
  const alarmSessionActiveRef = useRef<boolean>(false); // true only for "take pill" schedule alarm session

  const setAlarmVisibleSafe = (v: boolean) => {
    alarmVisibleRef.current = v;
    setAlarmVisible(v);
  };
  const setAlarmContainerSafe = (v: number) => {
    alarmContainerRef.current = v;
    setAlarmContainer(v);
  };
  const setPillMismatchVisibleSafe = (v: boolean) => {
    pillMismatchVisibleRef.current = v;
    setPillMismatchVisible(v);
  };

  // NEW: Show next alarm from queue
  const showNextAlarmFromQueue = () => {
    if (alarmQueueRef.current.length === 0) {
      console.log('[GlobalAlarmHandler] 🔔 Alarm queue is empty');
      return;
    }

    const nextAlarm = alarmQueueRef.current.shift()!;
    console.log(`[GlobalAlarmHandler] 🔔 Showing next alarm from queue: Container ${nextAlarm.container} at ${nextAlarm.time}`);
    console.log(`[GlobalAlarmHandler] 🔔 Remaining in queue: ${alarmQueueRef.current.length}`);

    setAlarmContainerSafe(nextAlarm.container);
    setAlarmTime(nextAlarm.time);
    setAlarmVisibleSafe(true);
    setRemainingAlarms(alarmQueueRef.current.length);
    alarmSessionActiveRef.current = true;
    lastAlarmKeyRef.current = nextAlarm.key;
    lastAlarmShownAtRef.current = nextAlarm.ts;

    // Mark schedule as Active
    DeviceEventEmitter.emit('pillnow:scheduleStatus', { container: nextAlarm.container, time: nextAlarm.time, status: 'Active' });
    markScheduleActive(nextAlarm.container, nextAlarm.time).catch(() => {});

    // Trigger capture for this container
    setTimeout(() => {
      triggerCaptureForContainer(nextAlarm.container).catch(() => {});
    }, 800);

    // Tell Arduino which container to light up
    BluetoothService.sendCommand(`ALARMTEST${nextAlarm.container}\n`).catch(() => {});
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

    // Clean up old processed alarms after 3 minutes (longer to prevent duplicates)
    setTimeout(() => {
      processedAlarmsRef.current.delete(key);
    }, 180000);

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
      const matchingSchedule =
        allSchedules.find((s: any) => String(s.date || '').slice(0, 10) === date &&
          parseInt(s.container) === container &&
          String(s.time).substring(0, 5) === timeStr) ||
        allSchedules.find((s: any) =>
          parseInt(s.container) === container && String(s.time).substring(0, 5) === timeStr);

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

  const showMismatchForContainer = async (containerNum: number) => {
    // Validate container number (1, 2, or 3)
    if (containerNum < 1 || containerNum > 3) {
      console.warn(`[GlobalAlarmHandler] ⚠️ Invalid container number: ${containerNum}, ignoring mismatch`);
      return;
    }
    
    const now = Date.now();
    
    // Enhanced global cooldown to prevent stacking modals (15 seconds)
    if (pillMismatchVisibleRef.current) {
      console.log(`[GlobalAlarmHandler] ⏳ Mismatch modal already visible, skipping duplicate`);
      return;
    }
    
    if (now - lastMismatchShownAtRef.current < 15000) {
      console.log(`[GlobalAlarmHandler] ⏳ Global mismatch cooldown active (${Math.round((15000 - (now - lastMismatchShownAtRef.current)) / 1000)}s remaining), skipping`);
      return;
    }
    
    // Enhanced per-container cooldown to prevent duplicate mismatch modals (90 seconds)
    const lastByContainer = lastMismatchByContainerRef.current.get(containerNum);
    if (lastByContainer && now - lastByContainer.shownAt < 90000) {
      const remaining = Math.round((90000 - (now - lastByContainer.shownAt)) / 1000);
      console.log(`[GlobalAlarmHandler] ⏳ Container ${containerNum} mismatch cooldown active (${remaining}s remaining), skipping duplicate`);
      return;
    }

    // Prevent race conditions: if multiple PILLALERTs arrive quickly, only allow one
    // mismatch verification/modal flow per container at a time.
    if (mismatchInFlightRef.current.has(containerNum)) {
      console.log(`[GlobalAlarmHandler] ⏳ Mismatch verification already in flight for container ${containerNum}, skipping`);
      return;
    }
    mismatchInFlightRef.current.add(containerNum);

    const containerId = `container${containerNum}`;
    console.log(`[GlobalAlarmHandler] 🔍 Fetching verification result for ${containerId}...`);
    
    try {
      const result = await verificationService.getVerificationResult(containerId);
      const verificationTs = (result as any)?.timestamp ? String((result as any).timestamp) : undefined;

      // If we already showed a mismatch for this exact verification result, don't show again.
      if (verificationTs && lastByContainer?.verificationTs === verificationTs) {
        console.log(`[GlobalAlarmHandler] ⏳ Already showed mismatch for this verification, skipping`);
        return;
      }

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
        console.log(`[GlobalAlarmHandler] Verification result: pass_=${result.result?.pass_}, success=${result.success}`);
      }

      // Fallback generic modal if verification isn't available yet
      console.log(`[GlobalAlarmHandler] ⚠️ Showing fallback mismatch modal (no detailed verification available)`);
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
    } finally {
      mismatchInFlightRef.current.delete(containerNum);
    }
  };

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
      const cfgResp = await fetch(`http://10.100.56.91:5001/get-pill-config/${containerId}`);
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

  useEffect(() => {
    let active = true;

    // If Bluetooth is not connected, we still keep handler mounted; it will just not receive.
    BluetoothService.isConnectionActive().then((isConnected) => {
      if (!isConnected) {
        console.warn('[GlobalAlarmHandler] Bluetooth not connected; alarms/mismatch modals require HC-05 connection.');
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
        const container = parseInt(match[1]);
        const timeStr = `${match[2].padStart(2, '0')}:${match[3]}`;

        console.log(`[GlobalAlarmHandler] 📨 Received ALARM_TRIGGERED for Container ${container} at ${timeStr}`);

        // If a mismatch alert came in slightly earlier, cancel its immediate display and queue it instead.
        if (pendingMismatchTimerRef.current) {
          clearTimeout(pendingMismatchTimerRef.current);
          pendingMismatchTimerRef.current = null;
        }
        if (pendingMismatchCandidateRef.current) {
          pendingMismatchRef.current = { container: pendingMismatchCandidateRef.current, ts: Date.now() };
          pendingMismatchCandidateRef.current = null;
        }

        // Don't stack on mismatch modal
        if (pillMismatchVisibleRef.current) setPillMismatchVisibleSafe(false);

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

        // If no alarm modal is currently showing, show the first one from queue
        if (!alarmVisibleRef.current) {
          console.log(`[GlobalAlarmHandler] 🔔 Showing first alarm from queue (${queueSize} total in queue)`);
          showNextAlarmFromQueue();
        } else {
          // Modal already visible, update remaining count
          setRemainingAlarms(queueSize);
          console.log(`[GlobalAlarmHandler] 🔔 Alarm queued (modal already visible). Queue size: ${queueSize}, remaining: ${queueSize - 1}`);
        }

        return;
      }

      // --- Alarm stopped (user pressed stop) ---
      if (trimmed.toUpperCase().includes('ALARM_STOPPED')) {
        const m = trimmed.match(/ALARM_STOPPED\s+C(\d+)/i);
        const container = m ? parseInt(m[1]) : alarmContainerRef.current;

        console.log(`[GlobalAlarmHandler] 🛑 Alarm stopped for Container ${container}`);
        setAlarmVisibleSafe(false);

        // Cancel any pending mismatch timer/candidate to avoid duplicates after stop.
        if (pendingMismatchTimerRef.current) {
          clearTimeout(pendingMismatchTimerRef.current);
          pendingMismatchTimerRef.current = null;
        }
        pendingMismatchCandidateRef.current = null;

        // Auto capture post-pill ONLY for schedule alarm sessions (not for mismatch buzzer stops).
        if (alarmSessionActiveRef.current) {
          alarmSessionActiveRef.current = false;
          setTimeout(() => {
            triggerCaptureForContainer(container).catch(() => {});
          }, 800);
        }

        // If we had a pending mismatch queued while alarm was visible, show it now
        const pending = pendingMismatchRef.current;
        pendingMismatchRef.current = null;
        if (pending && pending.container === container) {
          setTimeout(() => {
            showMismatchForContainer(container).catch(() => {});
          }, 2000);
        }

        // IMPROVED: Check if there are more alarms in the queue
        // This handles the case when 3 containers fire at the same time:
        // 1. User stops Container 1 alarm → shows Container 2 alarm
        // 2. User stops Container 2 alarm → shows Container 3 alarm
        // 3. User stops Container 3 alarm → all done
        if (alarmQueueRef.current.length > 0) {
          const remaining = alarmQueueRef.current.length;
          console.log(`[GlobalAlarmHandler] 🔔 More alarms in queue (${remaining} remaining), showing next in 1.5s...`);
          console.log(`[GlobalAlarmHandler] 📋 Next alarms: ${alarmQueueRef.current.map(a => `Container ${a.container}@${a.time}`).join(', ')}`);
          // Short delay before showing next alarm to let user see the transition
          setTimeout(() => {
            showNextAlarmFromQueue();
          }, 1500);
        } else {
          console.log(`[GlobalAlarmHandler] ✅ All alarms processed - queue is empty`);
          setRemainingAlarms(0);
        }

        return;
      }

      // --- Pill mismatch ---
      if (trimmed.toUpperCase().includes('PILLALERT')) {
        const m = trimmed.match(/PILLALERT\s+C(\d+)/i);
        const container = m ? parseInt(m[1]) : 1;

        // If alarm modal is up, queue mismatch to show after user stops alarm (prevents duplicates/stacking)
        if (alarmVisibleRef.current) {
          pendingMismatchRef.current = { container, ts: Date.now() };
          return;
        }

        // If we already showed a mismatch modal recently for this container, ignore spammy repeats.
        const lastShown = lastMismatchByContainerRef.current.get(container);
        if (lastShown && Date.now() - lastShown.shownAt < 60000) {
          return;
        }

        // Important: when alarm+capture fires, backend may immediately emit PILLALERT
        // and Bluetooth delivery can reorder messages. Buffer mismatch briefly so ALARM_TRIGGERED
        // can show the "take your pill" modal first.
        if (pendingMismatchTimerRef.current) {
          clearTimeout(pendingMismatchTimerRef.current);
          pendingMismatchTimerRef.current = null;
        }
        pendingMismatchCandidateRef.current = container;
        pendingMismatchTimerRef.current = setTimeout(() => {
          // If alarm became visible while waiting, keep it queued for after stop.
          if (alarmVisibleRef.current) {
            pendingMismatchRef.current = { container, ts: Date.now() };
            pendingMismatchCandidateRef.current = null;
            return;
          }
          showMismatchForContainer(container).catch(() => {});
          pendingMismatchCandidateRef.current = null;
        }, 2500);
        return;
      }
    });

    return () => {
      active = false;
      try {
        if (pendingMismatchTimerRef.current) {
          clearTimeout(pendingMismatchTimerRef.current);
          pendingMismatchTimerRef.current = null;
        }
      } catch {
        // ignore
      }
      try {
        cleanup?.();
      } catch {
        // ignore
      }
    };
    // We intentionally do NOT depend on alarmVisible/pillMismatchVisible to avoid re-registering listeners
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <AlarmModal
        visible={alarmVisible}
        container={alarmContainer}
        time={alarmTime}
        remainingAlarms={remainingAlarms}
        onDismiss={() => setAlarmVisibleSafe(false)}
        onStopImmediate={() => {
          // Make UI status update immediate when user hits Stop Alarm
          DeviceEventEmitter.emit('pillnow:scheduleStatus', { container: alarmContainerRef.current, time: alarmTime, status: 'Done' });
        }}
      />

      <PillMismatchModal
        visible={pillMismatchVisible}
        container={pillMismatchContainer}
        expectedLabel={pillMismatchExpected}
        detectedLabels={pillMismatchDetected}
        detectedCount={pillMismatchCount}
        expectedCount={pillMismatchExpectedCount}
        foreignPillsDetected={pillMismatchForeignPills}
        foreignPillLabels={pillMismatchForeignLabels}
        onDismiss={() => setPillMismatchVisibleSafe(false)}
      />
    </>
  );
}


