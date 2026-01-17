import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { Modal, View, StyleSheet, Platform } from 'react-native';

/**
 * ModalManager - Prevents modal overlaps and manages modal priority
 * 
 * Priority levels (higher number = higher priority):
 * - 100: Critical alerts (Alarm, Pill Mismatch)
 * - 50: Important modals (Backend config, etc.)
 * - 10: Standard modals (forms, confirmations)
 * - 1: Low priority (info, tooltips)
 */

export enum ModalPriority {
  LOW = 1,
  STANDARD = 10,
  IMPORTANT = 50,
  CRITICAL = 100,
}

interface ModalItem {
  id: string;
  component: React.ReactNode;
  priority: ModalPriority;
  visible: boolean;
  timestamp: number;
}

interface ModalManagerContextType {
  showModal: (id: string, component: React.ReactNode, priority?: ModalPriority) => void;
  hideModal: (id: string) => void;
  isModalVisible: (id: string) => boolean;
  getCurrentModal: () => ModalItem | null;
}

const ModalManagerContext = createContext<ModalManagerContextType | null>(null);

export const useModalManager = () => {
  const context = useContext(ModalManagerContext);
  if (!context) {
    throw new Error('useModalManager must be used within ModalManagerProvider');
  }
  return context;
};

export const ModalManagerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [modals, setModals] = useState<Map<string, ModalItem>>(new Map());
  const currentModalRef = useRef<string | null>(null);

  const showModal = useCallback((id: string, component: React.ReactNode, priority: ModalPriority = ModalPriority.STANDARD) => {
    setModals((prev) => {
      const newModals = new Map(prev);
      newModals.set(id, {
        id,
        component,
        priority,
        visible: true,
        timestamp: Date.now(),
      });
      return newModals;
    });
  }, []);

  const hideModal = useCallback((id: string) => {
    setModals((prev) => {
      const newModals = new Map(prev);
      const modal = newModals.get(id);
      if (modal) {
        newModals.set(id, { ...modal, visible: false });
        // Remove after animation completes
        setTimeout(() => {
          setModals((current) => {
            const updated = new Map(current);
            updated.delete(id);
            return updated;
          });
        }, 300);
      }
      return newModals;
    });
    if (currentModalRef.current === id) {
      currentModalRef.current = null;
    }
  }, []);

  const isModalVisible = useCallback((id: string) => {
    const modal = modals.get(id);
    return modal?.visible === true;
  }, [modals]);

  const getCurrentModal = useCallback((): ModalItem | null => {
    const visibleModals = Array.from(modals.values())
      .filter((m) => m.visible)
      .sort((a, b) => {
        // Sort by priority (higher first), then by timestamp (newer first)
        if (b.priority !== a.priority) {
          return b.priority - a.priority;
        }
        return b.timestamp - a.timestamp;
      });

    return visibleModals[0] || null;
  }, [modals]);

  const currentModal = getCurrentModal();

  // Update current modal ref
  useEffect(() => {
    if (currentModal) {
      currentModalRef.current = currentModal.id;
    } else {
      currentModalRef.current = null;
    }
  }, [currentModal]);

  return (
    <ModalManagerContext.Provider value={{ showModal, hideModal, isModalVisible, getCurrentModal }}>
      {children}
      {/* Render only the highest priority modal */}
      {currentModal && (
        <Modal
          visible={currentModal.visible}
          transparent
          animationType="fade"
          statusBarTranslucent
          hardwareAccelerated
          onRequestClose={() => hideModal(currentModal.id)}
        >
          <View style={styles.modalWrapper} pointerEvents="box-none">
            <View style={styles.modalContainer} pointerEvents="box-none">
              {currentModal.component}
            </View>
          </View>
        </Modal>
      )}
    </ModalManagerContext.Provider>
  );
};

const styles = StyleSheet.create({
  modalWrapper: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    ...Platform.select({
      ios: {
        zIndex: 9999,
      },
      android: {
        elevation: 1000,
      },
    }),
  },
  modalContainer: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
});


// Default export for Expo Router compatibility
export default ModalManagerProvider;
