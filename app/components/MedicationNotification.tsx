import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../context/ThemeContext';
import { lightTheme, darkTheme } from '../styles/theme';
import iotService from '../services/IoTService';
import { soundService } from '../services/soundService';

interface MedicationNotificationProps {
  medicineName: string;
  containerId: number;
  scheduledTime: string;
  onDismiss: () => void;
  enableIoT?: boolean;
}

const MedicationNotification: React.FC<MedicationNotificationProps> = ({
  medicineName,
  containerId,
  scheduledTime,
  onDismiss,
  enableIoT = true,
}) => {
  const [isVisible, setIsVisible] = useState(true);
  const [iotAlertActive, setIotAlertActive] = useState(false);
  const fadeAnim = new Animated.Value(1);
  const { isDarkMode } = useTheme();
  const theme = isDarkMode ? darkTheme : lightTheme;

  useEffect(() => {
    // Initialize sound service
    soundService.initialize();
    
    // Play alarm sound when notification appears
    soundService.playAlarmSound('alarm');
    
    // Trigger IoT alert when notification appears
    if (enableIoT && iotService.isDeviceConnected()) {
      triggerIoTAlert();
    }

    // Cleanup: Stop sound when component unmounts
    return () => {
      soundService.stopSound();
    };
  }, []);

  const triggerIoTAlert = async () => {
    try {
      await iotService.triggerAlert();
      setIotAlertActive(true);
      
      // Send SMS notification
      const message = `Time to take ${medicineName}! Container ${containerId} at ${scheduledTime}`;
      await iotService.sendSMS(message);
      
      console.log('IoT alert triggered successfully');
    } catch (error) {
      console.error('Failed to trigger IoT alert:', error);
    }
  };

  const stopIoTAlert = async () => {
    try {
      await iotService.stopAlert();
      setIotAlertActive(false);
      console.log('IoT alert stopped');
    } catch (error) {
      console.error('Failed to stop IoT alert:', error);
    }
  };

  const handleDismiss = async () => {
    // Stop alarm sound
    await soundService.stopSound();
    
    // Stop IoT alert if active
    if (iotAlertActive) {
      await stopIoTAlert();
    }

    Animated.timing(fadeAnim, {
      toValue: 0,
      duration: 300,
      useNativeDriver: true,
    }).start(() => {
      setIsVisible(false);
      onDismiss();
    });
  };

  const handleSnooze = async () => {
    Alert.alert(
      'Snooze Medication',
      'How long would you like to snooze?',
      [
        { text: '5 minutes', onPress: () => snoozeMedication(5) },
        { text: '15 minutes', onPress: () => snoozeMedication(15) },
        { text: '30 minutes', onPress: () => snoozeMedication(30) },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  };

  const snoozeMedication = async (minutes: number) => {
    try {
      // Stop alarm sound
      await soundService.stopSound();
      
      // Stop current alert
      if (iotAlertActive) {
        await stopIoTAlert();
      }

      // Schedule new alert with sound
      setTimeout(async () => {
        // Play alarm sound again when snooze time is up
        await soundService.playAlarmSound('alarm');
        
        if (enableIoT && iotService.isDeviceConnected()) {
          await triggerIoTAlert();
        }
      }, minutes * 60 * 1000);

      // Dismiss current notification
      handleDismiss();
    } catch (error) {
      console.error('Failed to snooze medication:', error);
    }
  };

  if (!isVisible) return null;

  return (
    <Animated.View style={[styles.container, { opacity: fadeAnim, backgroundColor: theme.card }]}>
      <View style={styles.notificationContent}>
        <View style={[styles.iconContainer, { backgroundColor: theme.background }]}>
          <Ionicons 
            name={iotAlertActive ? "bluetooth" : "notifications"} 
            size={24} 
            color={iotAlertActive ? theme.success : theme.primary} 
          />
        </View>
        
        <View style={styles.textContainer}>
          <Text style={[styles.title, { color: theme.secondary }]}>Time to take your medicine!</Text>
          <Text style={[styles.medicineName, { color: theme.text }]}>{medicineName}</Text>
          <Text style={[styles.details, { color: theme.textSecondary }]}>Container {containerId} • {scheduledTime}</Text>
          
          {iotAlertActive && (
            <View style={[styles.iotStatus, { backgroundColor: theme.success }]}>
              <Ionicons name="checkmark-circle" size={16} color={theme.card} />
              <Text style={[styles.iotStatusText, { color: theme.card }]}>IoT Alert Active</Text>
            </View>
          )}
        </View>

        <View style={styles.buttonContainer}>
          <TouchableOpacity 
            style={[styles.snoozeButton, { backgroundColor: theme.warning }]} 
            onPress={handleSnooze}
          >
            <Ionicons name="time" size={20} color={theme.card} />
            <Text style={[styles.buttonText, { color: theme.card }]}>Snooze</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={[styles.dismissButton, { backgroundColor: theme.success }]} 
            onPress={handleDismiss}
          >
            <Ionicons name="checkmark" size={20} color={theme.card} />
            <Text style={[styles.buttonText, { color: theme.card }]}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    elevation: 5,
  },
  notificationContent: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  textContainer: {
    alignItems: 'center',
    gap: 10,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  medicineName: {
    fontSize: 20,
    textAlign: 'center',
  },
  details: {
    fontSize: 16,
    textAlign: 'center',
  },
  iotStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 6,
  },
  iotStatusText: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  buttonContainer: {
    flexDirection: 'row',
    gap: 15,
    marginTop: 20,
  },
  snoozeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 25,
    gap: 8,
  },
  dismissButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 25,
    gap: 8,
  },
  buttonText: {
    fontWeight: 'bold',
    fontSize: 16,
  },
});

export default MedicationNotification; 