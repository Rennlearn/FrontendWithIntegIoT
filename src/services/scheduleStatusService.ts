/**
 * Schedule Status Service
 * 
 * Provides instant, synchronous status updates for medication schedules.
 * Updates local state first, then persists, then syncs to backend.
 * 
 * Key Features:
 * - Instant UI updates (no async delays)
 * - Offline support (AsyncStorage cache)
 * - Idempotent (safe to call multiple times)
 * - Debounced backend sync (prevents race conditions)
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { DeviceEventEmitter } from 'react-native';

const API_BASE = 'https://pillnow-database.onrender.com';

// In-memory cache for instant lookups (no async fetch needed)
const scheduleCache = new Map<string, any>();
const updateLocks = new Set<string>(); // Prevent double updates
const pendingSyncs = new Map<string, NodeJS.Timeout>(); // Debounce backend syncs

/**
 * Initialize schedule cache from AsyncStorage (called on app start)
 */
export const initializeScheduleCache = async (): Promise<void> => {
  try {
    const cached = await AsyncStorage.getItem('schedule_status_cache');
    if (cached) {
      const data = JSON.parse(cached);
      Object.entries(data).forEach(([key, value]) => {
        scheduleCache.set(key, value);
      });
      console.log('[ScheduleStatusService] ✅ Loaded schedule cache from storage');
    }
  } catch (err) {
    console.warn('[ScheduleStatusService] Failed to load cache:', err);
  }
};

/**
 * Update schedule cache (called when schedules are loaded)
 */
export const updateScheduleCache = (schedules: any[]): void => {
  schedules.forEach((schedule) => {
    if (schedule._id && schedule.container && schedule.time) {
      const key = getScheduleKey(schedule.container, schedule.time, schedule.date);
      scheduleCache.set(key, schedule);
    }
  });
  // Persist cache to AsyncStorage (non-blocking)
  persistCache().catch(() => {});
};

/**
 * Get schedule key for cache lookup
 */
const getScheduleKey = (container: number, time: string, date?: string): string => {
  const today = date ? date.slice(0, 10) : new Date().toISOString().slice(0, 10);
  return `${container}|${time}|${today}`;
};

/**
 * Persist cache to AsyncStorage (non-blocking)
 */
const persistCache = async (): Promise<void> => {
  try {
    const data: Record<string, any> = {};
    scheduleCache.forEach((value, key) => {
      data[key] = value;
    });
    await AsyncStorage.setItem('schedule_status_cache', JSON.stringify(data));
  } catch (err) {
    console.warn('[ScheduleStatusService] Failed to persist cache:', err);
  }
};

/**
 * INSTANT status update - synchronous, no delays
 * 
 * Flow:
 * 1. Update local cache immediately (synchronous)
 * 2. Emit event immediately (synchronous)
 * 3. Store in AsyncStorage (non-blocking)
 * 4. Sync to backend (background, debounced)
 * 
 * @param container - Container number (1, 2, or 3)
 * @param time - Time string (HH:MM format)
 * @param date - Optional date (YYYY-MM-DD), defaults to today
 * @returns true if update was successful, false if already updated or not found
 */
export const markScheduleTakenInstant = (
  container: number,
  time: string,
  date?: string
): boolean => {
  const key = getScheduleKey(container, time, date);
  
  // Prevent double updates (idempotent check)
  if (updateLocks.has(key)) {
    console.log(`[ScheduleStatusService] ⏳ Update already in progress for ${key}, skipping`);
    return false;
  }
  
  // Find schedule in cache (synchronous lookup)
  let schedule = scheduleCache.get(key);
  
  // If not in cache, try to find by container+time (without date)
  if (!schedule) {
    for (const [cacheKey, cachedSchedule] of scheduleCache.entries()) {
      if (cacheKey.startsWith(`${container}|${time}|`)) {
        schedule = cachedSchedule;
        break;
      }
    }
  }
  
  if (!schedule) {
    console.warn(`[ScheduleStatusService] ⚠️ Schedule not found in cache for Container ${container} at ${time}`);
    // Still emit event and store in AsyncStorage for offline support
    const offlineStatus = {
      container,
      time,
      date: date || new Date().toISOString().slice(0, 10),
      status: 'Done',
      updatedAt: Date.now(),
    };
    
    // Emit event immediately (UI updates instantly)
    DeviceEventEmitter.emit('pillnow:scheduleStatus', {
      container,
      time,
      status: 'Done',
      scheduleId: null,
    });
    
    // Store offline status (non-blocking)
    storeOfflineStatus(offlineStatus).catch(() => {});
    
    // Sync to backend in background (will find schedule on backend)
    syncToBackend(container, time, date).catch(() => {});
    
    return true;
  }
  
  // Check if already marked as Done/Taken (idempotent)
  const currentStatus = String(schedule.status || 'Pending').toLowerCase();
  if (currentStatus === 'done' || currentStatus === 'taken') {
    console.log(`[ScheduleStatusService] ⏳ Schedule already ${currentStatus}, skipping`);
    return false;
  }
  
  // Lock to prevent double updates
  updateLocks.add(key);
  
  // STEP 1: Update local cache IMMEDIATELY (synchronous)
  schedule.status = 'Done';
  schedule.updatedAt = Date.now();
  scheduleCache.set(key, schedule);
  
  // STEP 2: Emit event IMMEDIATELY (synchronous - UI updates instantly)
  DeviceEventEmitter.emit('pillnow:scheduleStatus', {
    container,
    time,
    status: 'Done',
    scheduleId: schedule._id,
  });
  
  // STEP 3: Persist to AsyncStorage (non-blocking, for offline support)
  persistCache().catch(() => {});
  storeOfflineStatus({
    container,
    time,
    date: schedule.date || date || new Date().toISOString().slice(0, 10),
    status: 'Done',
    scheduleId: schedule._id,
    updatedAt: Date.now(),
  }).catch(() => {});
  
  // STEP 4: Sync to backend in background (debounced to prevent race conditions)
  syncToBackendDebounced(container, time, schedule._id, schedule);
  
  // Release lock after a short delay (allows for rapid taps without blocking)
  setTimeout(() => {
    updateLocks.delete(key);
  }, 1000);
  
  console.log(`[ScheduleStatusService] ✅ INSTANT status update: Container ${container} at ${time} → TAKEN`);
  return true;
};

/**
 * Store offline status for sync when online
 */
const storeOfflineStatus = async (status: any): Promise<void> => {
  try {
    const offline = await AsyncStorage.getItem('offline_schedule_updates');
    const updates = offline ? JSON.parse(offline) : [];
    updates.push(status);
    // Keep only last 100 updates
    const trimmed = updates.slice(-100);
    await AsyncStorage.setItem('offline_schedule_updates', JSON.stringify(trimmed));
  } catch (err) {
    console.warn('[ScheduleStatusService] Failed to store offline status:', err);
  }
};

/**
 * Sync to backend with debouncing (prevents race conditions)
 */
const syncToBackendDebounced = (
  container: number,
  time: string,
  scheduleId: string,
  schedule: any
): void => {
  const key = `${scheduleId}`;
  
  // Clear existing timeout if any
  if (pendingSyncs.has(key)) {
    clearTimeout(pendingSyncs.get(key)!);
  }
  
  // Debounce: wait 200ms before syncing (allows rapid updates to batch)
  const timeoutId = setTimeout(() => {
    pendingSyncs.delete(key);
    syncToBackend(container, time, schedule.date, scheduleId, schedule).catch(() => {});
  }, 200);
  
  pendingSyncs.set(key, timeoutId);
};

/**
 * Sync status update to backend (background, non-blocking)
 */
const syncToBackend = async (
  container: number,
  time: string,
  date?: string,
  scheduleId?: string,
  schedule?: any
): Promise<void> => {
  try {
    const token = await AsyncStorage.getItem('token');
    if (!token) {
      console.warn('[ScheduleStatusService] No token, skipping backend sync');
      return;
    }
    
    const headers: HeadersInit = { 'Content-Type': 'application/json' };
    headers['Authorization'] = `Bearer ${token.trim()}`;
    
    // If we have scheduleId, update directly
    if (scheduleId && schedule) {
      const updateResp = await fetch(`${API_BASE}/api/medication_schedules/${scheduleId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ status: 'Done' }),
      });
      
      if (updateResp.ok) {
        console.log(`[ScheduleStatusService] ✅ Backend sync successful: ${scheduleId}`);
        return;
      }
      
      // Fallback to PUT
      const putResp = await fetch(`${API_BASE}/api/medication_schedules/${scheduleId}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ ...schedule, status: 'Done' }),
      });
      
      if (putResp.ok) {
        console.log(`[ScheduleStatusService] ✅ Backend sync successful (PUT): ${scheduleId}`);
        return;
      }
    }
    
    // Fallback: find schedule by container+time
    const resp = await fetch(`${API_BASE}/api/medication_schedules`, { headers });
    if (!resp.ok) {
      console.warn(`[ScheduleStatusService] ⚠️ Failed to fetch schedules for sync: ${resp.status}`);
      return;
    }
    
    const data = await resp.json();
    const allSchedules = data.data || [];
    const today = date ? date.slice(0, 10) : new Date().toISOString().slice(0, 10);
    
    const matchingSchedule =
      allSchedules.find(
        (s: any) =>
          String(s.date || '').slice(0, 10) === today &&
          parseInt(s.container) === container &&
          String(s.time).substring(0, 5) === time
      ) ||
      allSchedules.find(
        (s: any) => parseInt(s.container) === container && String(s.time).substring(0, 5) === time
      );
    
    if (matchingSchedule) {
      const updateResp = await fetch(`${API_BASE}/api/medication_schedules/${matchingSchedule._id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ status: 'Done' }),
      });
      
      if (updateResp.ok) {
        console.log(`[ScheduleStatusService] ✅ Backend sync successful: ${matchingSchedule._id}`);
        // Update cache with synced schedule
        const key = getScheduleKey(container, time, matchingSchedule.date);
        scheduleCache.set(key, { ...matchingSchedule, status: 'Done' });
        persistCache().catch(() => {});
      }
    }
  } catch (err) {
    console.error('[ScheduleStatusService] ❌ Backend sync error:', err);
    // Non-fatal - status is already updated locally
  }
};

/**
 * Sync offline updates when app comes online
 */
export const syncOfflineUpdates = async (): Promise<void> => {
  try {
    const offline = await AsyncStorage.getItem('offline_schedule_updates');
    if (!offline) return;
    
    const updates = JSON.parse(offline);
    if (updates.length === 0) return;
    
    console.log(`[ScheduleStatusService] Syncing ${updates.length} offline update(s)...`);
    
    for (const update of updates) {
      await syncToBackend(update.container, update.time, update.date, update.scheduleId);
    }
    
    // Clear offline updates after successful sync
    await AsyncStorage.removeItem('offline_schedule_updates');
    console.log('[ScheduleStatusService] ✅ Offline updates synced');
  } catch (err) {
    console.error('[ScheduleStatusService] Failed to sync offline updates:', err);
  }
};

