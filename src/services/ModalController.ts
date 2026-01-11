/**
 * Global Modal Controller
 * 
 * SINGLE SOURCE OF TRUTH for all modal state in the application.
 * 
 * CRITICAL RULES:
 * - Only ONE modal may be active at any time (global guarantee)
 * - Modal state changes are SYNCHRONOUS (no delays, no async)
 * - All modal operations are IDEMPOTENT (same trigger = same result)
 * - Priority: ALARM > PILL_MISMATCH
 * 
 * This controller uses refs for instant state checks and prevents:
 * - Race conditions
 * - Duplicate modals
 * - Delayed modal opening
 * - Overlapping modals
 */

import type { MutableRefObject } from 'react';

export type ModalType = 'ALARM' | 'PILL_MISMATCH' | null;

type ModalState = {
  type: ModalType;
  isPresenting: boolean; // Lock to prevent re-entry
  timestamp: number; // When modal was opened (for debugging)
};

type StateChangeCallback = () => void;

class ModalController {
  // SINGLE SOURCE OF TRUTH: Current modal state
  private state: ModalState = {
    type: null,
    isPresenting: false,
    timestamp: 0,
  };

  // React refs for synchronous state access (no stale closures)
  private activeModalRef: MutableRefObject<ModalType> | null = null;
  private alarmLockRef: MutableRefObject<boolean> | null = null;
  private mismatchLockRef: MutableRefObject<boolean> | null = null;

  // Callbacks for React state sync
  private stateChangeCallbacks: Set<StateChangeCallback> = new Set();

  /**
   * Initialize the controller with React refs
   * This allows synchronous state checks without stale closures
   */
  initialize(
    activeModalRef: MutableRefObject<ModalType>,
    alarmLockRef: MutableRefObject<boolean>,
    mismatchLockRef: MutableRefObject<boolean>
  ): void {
    this.activeModalRef = activeModalRef;
    this.alarmLockRef = alarmLockRef;
    this.mismatchLockRef = mismatchLockRef;
    
    // Sync refs with current state
    if (this.activeModalRef) {
      this.activeModalRef.current = this.state.type;
    }
  }

  /**
   * Subscribe to state changes
   * Returns unsubscribe function
   */
  onStateChange(callback: StateChangeCallback): () => void {
    this.stateChangeCallbacks.add(callback);
    return () => {
      this.stateChangeCallbacks.delete(callback);
    };
  }

  /**
   * Notify all subscribers of state change
   * SYNCHRONOUS - no delays
   */
  private notifyStateChange(): void {
    this.stateChangeCallbacks.forEach(cb => {
      try {
        cb();
      } catch (e) {
        console.error('[ModalController] Error in state change callback:', e);
      }
    });
  }

  /**
   * Try to show Alarm Modal
   * 
   * PRIORITY: Alarm has highest priority - will close any other modal
   * IDEMPOTENT: Calling twice returns same result (no duplicate)
   * SYNCHRONOUS: State change happens immediately, no delays
   * 
   * @returns true if modal was shown/kept visible, false if blocked by lock
   */
  tryShowAlarm(): boolean {
    // Check lock to prevent duplicate triggers during state transition
    if (this.alarmLockRef?.current === true) {
      console.log('[ModalController] ⏳ Alarm lock active, preventing duplicate trigger');
      return false;
    }

    // IDEMPOTENT: If alarm is already showing, return success (no-op)
    if (this.state.type === 'ALARM') {
      console.log('[ModalController] ✅ Alarm already showing (idempotent)');
      return true;
    }

    // Set lock IMMEDIATELY to prevent race conditions
    if (this.alarmLockRef) {
      this.alarmLockRef.current = true;
    }

    // PRIORITY: Alarm has priority - close any other modal
    if (this.state.type === 'PILL_MISMATCH') {
      console.log('[ModalController] 🔄 Closing mismatch modal (alarm has priority)');
      this.closeMismatchInternal(); // Close without lock check
    }

    // Update state SYNCHRONOUSLY
    this.state = {
      type: 'ALARM',
      isPresenting: true,
      timestamp: Date.now(),
    };

    // Sync refs IMMEDIATELY
    if (this.activeModalRef) {
      this.activeModalRef.current = 'ALARM';
    }

    // Notify subscribers IMMEDIATELY (synchronous)
    this.notifyStateChange();

    console.log('[ModalController] ✅ Alarm modal activated (synchronous)');

    // Release lock IMMEDIATELY (no setTimeout delay)
    if (this.alarmLockRef) {
      this.alarmLockRef.current = false;
    }

    return true;
  }

  /**
   * Try to show Pill Mismatch Modal
   * 
   * PRIORITY: Mismatch has lower priority - blocked if alarm is active
   * IDEMPOTENT: Calling twice returns same result (no duplicate)
   * SYNCHRONOUS: State change happens immediately, no delays
   * 
   * @returns true if modal was shown/kept visible, false if blocked
   */
  tryShowMismatch(): boolean {
    // Check lock to prevent duplicate triggers
    if (this.mismatchLockRef?.current === true) {
      console.log('[ModalController] ⏳ Mismatch lock active, preventing duplicate trigger');
      return false;
    }

    // PRIORITY CHECK: Alarm modal has priority - block mismatch if alarm is showing
    if (this.state.type === 'ALARM') {
      console.log('[ModalController] ⏳ Alarm modal is active, blocking mismatch (alarm has priority)');
      return false;
    }

    // IDEMPOTENT: If mismatch is already showing, return success (no-op)
    if (this.state.type === 'PILL_MISMATCH') {
      console.log('[ModalController] ✅ Mismatch already showing (idempotent)');
      return true;
    }

    // Set lock IMMEDIATELY to prevent race conditions
    if (this.mismatchLockRef) {
      this.mismatchLockRef.current = true;
    }

    // Update state SYNCHRONOUSLY
    this.state = {
      type: 'PILL_MISMATCH',
      isPresenting: true,
      timestamp: Date.now(),
    };

    // Sync refs IMMEDIATELY
    if (this.activeModalRef) {
      this.activeModalRef.current = 'PILL_MISMATCH';
    }

    // Notify subscribers IMMEDIATELY (synchronous)
    this.notifyStateChange();

    console.log('[ModalController] ✅ Mismatch modal activated (synchronous)');

    // Release lock IMMEDIATELY (no setTimeout delay)
    if (this.mismatchLockRef) {
      this.mismatchLockRef.current = false;
    }

    return true;
  }

  /**
   * Close Alarm Modal
   * 
   * IDEMPOTENT: Safe to call multiple times
   * SYNCHRONOUS: State change happens immediately
   */
  closeAlarm(): void {
    if (this.state.type !== 'ALARM') {
      return; // Idempotent - already closed
    }

    // Update state SYNCHRONOUSLY
    this.state = {
      type: null,
      isPresenting: false,
      timestamp: 0,
    };

    // Sync refs IMMEDIATELY
    if (this.activeModalRef) {
      this.activeModalRef.current = null;
    }

    // Release lock
    if (this.alarmLockRef) {
      this.alarmLockRef.current = false;
    }

    // Notify subscribers IMMEDIATELY
    this.notifyStateChange();

    console.log('[ModalController] ✅ Alarm modal closed (synchronous)');
  }

  /**
   * Close Pill Mismatch Modal
   * 
   * IDEMPOTENT: Safe to call multiple times
   * SYNCHRONOUS: State change happens immediately
   */
  closeMismatch(): void {
    this.closeMismatchInternal();
  }

  /**
   * Internal close mismatch (bypasses lock check for priority handling)
   */
  private closeMismatchInternal(): void {
    if (this.state.type !== 'PILL_MISMATCH') {
      return; // Idempotent - already closed
    }

    // Update state SYNCHRONOUSLY
    this.state = {
      type: null,
      isPresenting: false,
      timestamp: 0,
    };

    // Sync refs IMMEDIATELY
    if (this.activeModalRef) {
      this.activeModalRef.current = null;
    }

    // Release lock
    if (this.mismatchLockRef) {
      this.mismatchLockRef.current = false;
    }

    // Notify subscribers IMMEDIATELY
    this.notifyStateChange();

    console.log('[ModalController] ✅ Mismatch modal closed (synchronous)');
  }

  /**
   * Get current active modal type
   */
  getActiveModal(): ModalType {
    return this.state.type;
  }

  /**
   * Check if alarm modal is active
   */
  isAlarmActive(): boolean {
    return this.state.type === 'ALARM';
  }

  /**
   * Check if mismatch modal is active
   */
  isMismatchActive(): boolean {
    return this.state.type === 'PILL_MISMATCH';
  }

  /**
   * Check if any modal is active
   */
  isAnyModalActive(): boolean {
    return this.state.type !== null;
  }

  /**
   * Check if a modal is currently being presented (lock active)
   */
  isPresenting(): boolean {
    return this.state.isPresenting;
  }

  /**
   * Force close all modals (emergency reset)
   */
  closeAll(): void {
    this.state = {
      type: null,
      isPresenting: false,
      timestamp: 0,
    };

    if (this.activeModalRef) {
      this.activeModalRef.current = null;
    }

    if (this.alarmLockRef) {
      this.alarmLockRef.current = false;
    }

    if (this.mismatchLockRef) {
      this.mismatchLockRef.current = false;
    }

    this.notifyStateChange();
    console.log('[ModalController] ✅ All modals force-closed');
  }
}

// Export singleton instance
export const modalController = new ModalController();

