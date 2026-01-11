/**
 * Alarm Trigger Tracker
 * 
 * Tracks when alarms are triggered for each schedule to implement a 1-minute grace period.
 * 
 * GRACE PERIOD RULE:
 * - When an alarm triggers, the schedule must remain visible for exactly 60 seconds
 * - During this period, the schedule stays visible even if marked as TAKEN
 * - After 60 seconds, the schedule can be safely removed or moved to history
 * 
 * This ensures users have time to see and interact with the alarm before it disappears.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

type AlarmTriggerRecord = {
  container: number;
  time: string;
  date?: string;
  triggeredAt: number; // Unix timestamp in milliseconds
};

const STORAGE_KEY = 'alarm_trigger_timestamps';
const GRACE_PERIOD_MS = 60 * 1000; // 60 seconds

class AlarmTriggerTracker {
  private triggers: Map<string, AlarmTriggerRecord> = new Map();

  /**
   * Initialize tracker by loading persisted timestamps from AsyncStorage
   * This ensures grace period continues even after app restart
   */
  async initialize(): Promise<void> {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) {
        const data = JSON.parse(stored);
        // Only keep triggers that are still within grace period
        const now = Date.now();
        const validTriggers: Record<string, AlarmTriggerRecord> = {};
        
        for (const [key, record] of Object.entries(data)) {
          const trigger = record as AlarmTriggerRecord;
          const elapsed = now - trigger.triggeredAt;
          if (elapsed < GRACE_PERIOD_MS) {
            validTriggers[key] = trigger;
          }
        }
        
        this.triggers = new Map(Object.entries(validTriggers));
        await this.persist();
        console.log(`[AlarmTriggerTracker] Initialized with ${this.triggers.size} active grace periods`);
      }
    } catch (error) {
      console.error('[AlarmTriggerTracker] Error initializing:', error);
    }
  }

  /**
   * Record that an alarm was triggered for a specific schedule
   * 
   * @param container - Container number (1, 2, or 3)
   * @param time - Time string (e.g., "08:00")
   * @param date - Optional date string (e.g., "2025-01-15")
   */
  async recordAlarmTrigger(container: number, time: string, date?: string): Promise<void> {
    const key = this.getKey(container, time, date);
    const now = Date.now();
    
    const record: AlarmTriggerRecord = {
      container,
      time,
      date,
      triggeredAt: now,
    };
    
    this.triggers.set(key, record);
    await this.persist();
    
    console.log(`[AlarmTriggerTracker] ✅ Recorded alarm trigger: Container ${container} at ${time} (grace period until ${new Date(now + GRACE_PERIOD_MS).toLocaleTimeString()})`);
  }

  /**
   * Check if a schedule is currently within the 1-minute grace period after alarm trigger
   * 
   * CRITICAL: Alarm triggers may be recorded with or without date (depending on alarm message format).
   * This function checks both with-date and without-date keys to ensure grace period works correctly.
   * 
   * @param container - Container number
   * @param time - Time string (normalized to HH:MM)
   * @param date - Optional date string
   * @returns true if within grace period, false otherwise
   */
  isWithinGracePeriod(container: number, time: string, date?: string): boolean {
    // Normalize time to HH:MM format
    const normalizedTime = time.substring(0, 5);
    
    // Try exact match first (with date if provided)
    let key = this.getKey(container, normalizedTime, date);
    let record = this.triggers.get(key);
    
    // If no exact match and date was provided, try without date
    // (alarm triggers may be recorded without date from ALARM_TRIGGERED messages)
    if (!record && date) {
      key = this.getKey(container, normalizedTime);
      record = this.triggers.get(key);
    }
    
    // If still no match and no date was provided, try with today's date
    // (schedules have dates, but alarm might not include it)
    if (!record && !date) {
      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      key = this.getKey(container, normalizedTime, today);
      record = this.triggers.get(key);
    }
    
    if (!record) {
      return false;
    }
    
    const now = Date.now();
    const elapsed = now - record.triggeredAt;
    const isWithin = elapsed < GRACE_PERIOD_MS;
    
    if (!isWithin) {
      // Grace period expired - clean up
      this.triggers.delete(key);
      this.persist().catch(err => console.error('[AlarmTriggerTracker] Error cleaning up expired trigger:', err));
    }
    
    return isWithin;
  }

  /**
   * Get remaining grace period time in milliseconds
   * 
   * @param container - Container number
   * @param time - Time string
   * @param date - Optional date string
   * @returns Remaining milliseconds, or 0 if not within grace period
   */
  getRemainingGracePeriod(container: number, time: string, date?: string): number {
    const key = this.getKey(container, time, date);
    const record = this.triggers.get(key);
    
    if (!record) {
      return 0;
    }
    
    const now = Date.now();
    const elapsed = now - record.triggeredAt;
    const remaining = Math.max(0, GRACE_PERIOD_MS - elapsed);
    
    if (remaining === 0) {
      // Grace period expired - clean up
      this.triggers.delete(key);
      this.persist().catch(err => console.error('[AlarmTriggerTracker] Error cleaning up expired trigger:', err));
    }
    
    return remaining;
  }

  /**
   * Clear a specific alarm trigger record (e.g., when schedule is manually dismissed)
   */
  async clearTrigger(container: number, time: string, date?: string): Promise<void> {
    const key = this.getKey(container, time, date);
    this.triggers.delete(key);
    await this.persist();
  }

  /**
   * Clear all expired triggers (cleanup)
   */
  async cleanupExpired(): Promise<void> {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [key, record] of this.triggers.entries()) {
      const elapsed = now - record.triggeredAt;
      if (elapsed >= GRACE_PERIOD_MS) {
        this.triggers.delete(key);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      await this.persist();
      console.log(`[AlarmTriggerTracker] Cleaned up ${cleaned} expired trigger(s)`);
    }
  }

  /**
   * Generate a unique key for a schedule
   */
  private getKey(container: number, time: string, date?: string): string {
    // Normalize time to HH:MM format
    const normalizedTime = time.substring(0, 5);
    if (date) {
      return `${container}|${date}|${normalizedTime}`;
    }
    return `${container}|${normalizedTime}`;
  }

  /**
   * Persist triggers to AsyncStorage
   */
  private async persist(): Promise<void> {
    try {
      const data = Object.fromEntries(this.triggers);
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (error) {
      console.error('[AlarmTriggerTracker] Error persisting triggers:', error);
    }
  }
}

// Export singleton instance
export const alarmTriggerTracker = new AlarmTriggerTracker();

