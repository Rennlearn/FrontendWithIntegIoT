/**
 * Centralized Modal State Manager
 * 
 * Ensures only ONE modal can be visible at any time with explicit priority:
 * - Alarm Modal (Priority 1 - Highest)
 * - Pill Mismatch Modal (Priority 2)
 * 
 * This manager uses refs for synchronous state checks to prevent race conditions
 * and ensures all modal operations are idempotent.
 */

import type { MutableRefObject } from 'react';

type ModalType = 'alarm' | 'mismatch' | null;

class ModalStateManager {
  // Current active modal (null = no modal)
  private activeModalRef: MutableRefObject<ModalType> | null = null;
  
  // Locks to prevent duplicate triggers
  private alarmLockRef: MutableRefObject<boolean> | null = null;
  private mismatchLockRef: MutableRefObject<boolean> | null = null;
  
  // Callbacks for state changes
  private onStateChangeCallbacks: Set<() => void> = new Set();

  /**
   * Initialize the manager with refs from the component
   * This allows synchronous state checks without stale closures
   */
  initialize(
    activeModalRef: MutableRefObject<ModalType>,
    alarmLockRef: MutableRefObject<boolean>,
    mismatchLockRef: MutableRefObject<boolean>
  ) {
    this.activeModalRef = activeModalRef;
    this.alarmLockRef = alarmLockRef;
    this.mismatchLockRef = mismatchLockRef;
  }

  /**
   * Register a callback to be notified when modal state changes
   */
  onStateChange(callback: () => void): () => void {
    this.onStateChangeCallbacks.add(callback);
    return () => {
      this.onStateChangeCallbacks.delete(callback);
    };
  }

  /**
   * Notify all registered callbacks of state change
   */
  private notifyStateChange() {
    this.onStateChangeCallbacks.forEach(cb => {
      try {
        cb();
      } catch (e) {
        console.error('[ModalStateManager] Error in state change callback:', e);
      }
    });
  }

  /**
   * Try to show Alarm Modal
   * 
   * PRIORITY RULE: Alarm modal has highest priority
   * - If mismatch modal is showing, it will be closed
   * - If alarm modal is already showing, this is idempotent (no-op)
   * 
   * @returns true if modal was shown/kept visible, false if blocked
   */
  tryShowAlarm(): boolean {
    if (!this.activeModalRef || !this.alarmLockRef) {
      console.error('[ModalStateManager] Not initialized');
      return false;
    }

    // Check lock to prevent duplicate triggers
    if (this.alarmLockRef.current) {
      console.log('[ModalStateManager] ⏳ Alarm lock active, preventing duplicate trigger');
      return false;
    }

    // Set lock immediately to prevent race conditions
    this.alarmLockRef.current = true;

    // If alarm is already showing, this is idempotent
    if (this.activeModalRef.current === 'alarm') {
      console.log('[ModalStateManager] ✅ Alarm already showing (idempotent)');
      this.alarmLockRef.current = false;
      return true;
    }

    // Alarm has priority - close any other modal
    if (this.activeModalRef.current === 'mismatch') {
      console.log('[ModalStateManager] 🔄 Closing mismatch modal (alarm has priority)');
      // Mismatch will be closed by the component when it sees activeModalRef changed
    }

    // Set alarm as active
    this.activeModalRef.current = 'alarm';
    this.notifyStateChange();

    console.log('[ModalStateManager] ✅ Alarm modal activated');
    
    // Release lock after a brief moment (allows state to propagate)
    setTimeout(() => {
      if (this.alarmLockRef) {
        this.alarmLockRef.current = false;
      }
    }, 100);

    return true;
  }

  /**
   * Try to show Pill Mismatch Modal
   * 
   * PRIORITY RULE: Mismatch modal has lower priority than alarm
   * - If alarm modal is showing, mismatch will be queued/blocked
   * - If mismatch modal is already showing, this is idempotent (no-op)
   * 
   * @returns true if modal was shown/kept visible, false if blocked
   */
  tryShowMismatch(): boolean {
    if (!this.activeModalRef || !this.mismatchLockRef) {
      console.error('[ModalStateManager] Not initialized');
      return false;
    }

    // Check lock to prevent duplicate triggers
    if (this.mismatchLockRef.current) {
      console.log('[ModalStateManager] ⏳ Mismatch lock active, preventing duplicate trigger');
      return false;
    }

    // PRIORITY CHECK: Alarm modal has priority - block mismatch if alarm is showing
    if (this.activeModalRef.current === 'alarm') {
      console.log('[ModalStateManager] ⏳ Alarm modal is active, blocking mismatch (alarm has priority)');
      return false;
    }

    // Set lock immediately to prevent race conditions
    this.mismatchLockRef.current = true;

    // If mismatch is already showing, this is idempotent
    if (this.activeModalRef.current === 'mismatch') {
      console.log('[ModalStateManager] ✅ Mismatch already showing (idempotent)');
      this.mismatchLockRef.current = false;
      return true;
    }

    // Set mismatch as active
    this.activeModalRef.current = 'mismatch';
    this.notifyStateChange();

    console.log('[ModalStateManager] ✅ Mismatch modal activated');
    
    // Release lock after a brief moment (allows state to propagate)
    setTimeout(() => {
      if (this.mismatchLockRef) {
        this.mismatchLockRef.current = false;
      }
    }, 100);

    return true;
  }

  /**
   * Close Alarm Modal
   * 
   * This fully resets the alarm state and allows other modals to show
   */
  closeAlarm(): void {
    if (!this.activeModalRef || !this.alarmLockRef) {
      return;
    }

    // Only close if alarm is actually showing
    if (this.activeModalRef.current === 'alarm') {
      this.activeModalRef.current = null;
      this.alarmLockRef.current = false;
      this.notifyStateChange();
      console.log('[ModalStateManager] ✅ Alarm modal closed');
    }
  }

  /**
   * Close Pill Mismatch Modal
   * 
   * This fully resets the mismatch state and allows other modals to show
   */
  closeMismatch(): void {
    if (!this.activeModalRef || !this.mismatchLockRef) {
      return;
    }

    // Only close if mismatch is actually showing
    if (this.activeModalRef.current === 'mismatch') {
      this.activeModalRef.current = null;
      this.mismatchLockRef.current = false;
      this.notifyStateChange();
      console.log('[ModalStateManager] ✅ Mismatch modal closed');
    }
  }

  /**
   * Get current active modal type
   * 
   * @returns 'alarm', 'mismatch', or null
   */
  getActiveModal(): ModalType {
    return this.activeModalRef?.current ?? null;
  }

  /**
   * Check if alarm modal is currently active
   */
  isAlarmActive(): boolean {
    return this.activeModalRef?.current === 'alarm';
  }

  /**
   * Check if mismatch modal is currently active
   */
  isMismatchActive(): boolean {
    return this.activeModalRef?.current === 'mismatch';
  }

  /**
   * Check if any modal is currently active
   */
  isAnyModalActive(): boolean {
    return this.activeModalRef?.current !== null;
  }

  /**
   * Force close all modals (emergency reset)
   */
  closeAll(): void {
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
    console.log('[ModalStateManager] ✅ All modals force-closed');
  }
}

// Export singleton instance
export const modalStateManager = new ModalStateManager();

