import React, { useState, useCallback } from 'react';
import { Modal, View, StyleSheet } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { lightTheme, darkTheme } from '../styles/theme';
import MedicationNotification from './MedicationNotification';
import { notificationService, NotificationData } from '../services/notificationService';

interface NotificationManagerProps {
  visible: boolean;
  onClose: () => void;
  notificationData?: NotificationData;
  onNotificationDismissed?: (notificationId: string) => void;
}

const NotificationManager: React.FC<NotificationManagerProps> = ({
  visible,
  onClose,
  notificationData,
  onNotificationDismissed
}) => {
  const { isDarkMode } = useTheme();
  const theme = isDarkMode ? darkTheme : lightTheme;
  const [isLoading, setIsLoading] = useState(false);

  const handleDismiss = useCallback(async () => {
    if (!notificationData) {
      onClose();
      return;
    }

    try {
      setIsLoading(true);
      if (notificationData.isTest || notificationData.id.startsWith('local_test_')) {
        onClose();
        if (onNotificationDismissed) {
          onNotificationDismissed(notificationData.id);
        }
        return;
      }

      await notificationService.dismissNotification(notificationData.id);

      onClose();
      if (onNotificationDismissed) {
        onNotificationDismissed(notificationData.id);
      }
    } catch (error) {
      console.error('Error dismissing notification:', error);
      onClose();
      if (onNotificationDismissed) {
        onNotificationDismissed(notificationData.id);
      }
    } finally {
      setIsLoading(false);
    }
  }, [notificationData, onClose, onNotificationDismissed]);

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={[styles.modalOverlay, { backgroundColor: 'rgba(0, 0, 0, 0.5)' }]}>
        <View style={[styles.modalContent, { backgroundColor: theme.card }]}> 
          {notificationData ? (
            <MedicationNotification
              medicineName={notificationData.medicineName || notificationData.title}
              containerId={notificationData.containerId || 1}
              scheduledTime={notificationData.scheduledTime || '08:00 AM'}
              onDismiss={handleDismiss}
            />
          ) : (
            <View style={styles.placeholder} />
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    width: '85%',
    aspectRatio: 1,
    borderRadius: 25,
    padding: 30,
    elevation: 5,
  },
  placeholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default NotificationManager;




