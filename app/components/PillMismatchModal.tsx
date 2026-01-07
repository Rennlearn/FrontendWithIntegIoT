import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet, Animated, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { lightTheme, darkTheme } from '@/styles/theme';
import BluetoothService from '@/services/BluetoothService';

interface PillMismatchModalProps {
  visible: boolean;
  container: number;
  expectedLabel?: string;
  detectedLabels?: string;
  detectedCount?: number;
  expectedCount?: number;
  foreignPillsDetected?: boolean;
  foreignPillLabels?: string[];
  onDismiss: () => void;
}

const PillMismatchModal: React.FC<PillMismatchModalProps> = ({ 
  visible, 
  container, 
  expectedLabel = 'unknown',
  detectedLabels = 'none',
  detectedCount = 0,
  expectedCount = 0,
  foreignPillsDetected = false,
  foreignPillLabels = [],
  onDismiss 
}) => {
  const { isDarkMode } = useTheme();
  const theme = isDarkMode ? darkTheme : lightTheme;
  const [pulseAnim] = useState(new Animated.Value(1));

  useEffect(() => {
    if (visible) {
      console.log(`[PillMismatchModal] 🚨🚨🚨 Modal is now VISIBLE for Container ${container} 🚨🚨🚨`);
      // Pulse animation
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.2,
            duration: 500,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 500,
            useNativeDriver: true,
          }),
        ])
      ).start();
    }
  }, [visible, container]);

  const handleStopBuzzer = async () => {
    try {
      // Validate container number (1, 2, or 3)
      if (container < 1 || container > 3) {
        console.error(`[PillMismatchModal] ⚠️ Invalid container number: ${container}`);
        Alert.alert('Error', `Invalid container number: ${container}. Please contact support.`);
        return;
      }
      
      console.log(`[PillMismatchModal] 🛑 Stop buzzer button pressed for Container ${container}`);
      
      const isConnected = await BluetoothService.isConnectionActive();
      if (!isConnected) {
        Alert.alert(
          'Bluetooth Not Connected',
          'Cannot stop buzzer. Please connect to Bluetooth first.',
          [{ text: 'OK', onPress: () => onDismiss() }]
        );
        return;
      }
      
      console.log(`[PillMismatchModal] 📤 Sending ALARMSTOP command to Arduino...`);
      // Send command to stop the buzzer
      await BluetoothService.sendCommand('ALARMSTOP\n');
      console.log(`[PillMismatchModal] ✅ ALARMSTOP command sent successfully`);
      
      // Dismiss modal immediately
      onDismiss();
      
      // Show confirmation after a brief delay
      setTimeout(() => {
        Alert.alert(
          '✅ Buzzer Stopped', 
          'The alarm has been turned off. Please check the medication in the container.',
          [{ text: 'OK' }]
        );
      }, 300);
    } catch (error) {
      console.error('[PillMismatchModal] ❌ Error stopping buzzer:', error);
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      Alert.alert(
        'Error', 
        `Failed to stop buzzer: ${errorMsg}\n\nPlease try again or check Bluetooth connection.`,
        [
          { text: 'Retry', onPress: handleStopBuzzer },
          { text: 'Cancel', onPress: () => onDismiss(), style: 'cancel' }
        ]
      );
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      hardwareAccelerated
      onRequestClose={handleStopBuzzer}
    >
      <View style={styles.overlay}>
        <View style={[styles.modalContainer, { backgroundColor: theme.card }]}>
          <Animated.View style={[styles.iconContainer, { transform: [{ scale: pulseAnim }] }]}>
            <Ionicons name="warning" size={80} color={theme.error} />
          </Animated.View>
          
          <Text style={[styles.title, { color: theme.error }]}>⚠️ Pill Mismatch Detected!</Text>
          <Text style={[styles.containerText, { color: theme.text }]}>Container {container}</Text>
          
          <View style={styles.detailsContainer}>
            <Text style={[styles.detailLabel, { color: theme.textSecondary }]}>Expected:</Text>
            <Text style={[styles.detailValue, { color: theme.text }]}>
              {expectedCount > 0 ? `${expectedCount} x ` : ''}{expectedLabel}
            </Text>
            
            <Text style={[styles.detailLabel, { color: theme.textSecondary, marginTop: 10 }]}>Detected:</Text>
            <Text style={[styles.detailValue, { color: theme.error }]}>
              {detectedLabels} ({detectedCount} pills)
            </Text>
            
            {expectedCount > 0 && detectedCount !== expectedCount && (
              <>
                <Text style={[styles.detailLabel, { color: theme.textSecondary, marginTop: 10 }]}>Count Mismatch:</Text>
                <Text style={[styles.detailValue, { color: theme.error }]}>
                  Expected {expectedCount} but found {detectedCount}
                </Text>
              </>
            )}
            
            {foreignPillsDetected && foreignPillLabels.length > 0 && (
              <>
                <Text style={[styles.detailLabel, { color: theme.textSecondary, marginTop: 10 }]}>Foreign Pills:</Text>
                <Text style={[styles.detailValue, { color: theme.error }]}>
                  {foreignPillLabels.join(', ')}
                </Text>
              </>
            )}
          </View>
          
          <Text style={[styles.warningText, { color: theme.textSecondary }]}>
            {foreignPillsDetected ? (
              `⚠️ Foreign pill(s) detected! Expected only "${expectedLabel}", but also found: ${foreignPillLabels.join(', ')}. Please check the container.`
            ) : expectedCount > 0 && detectedCount !== expectedCount ? (
              `⚠️ Count mismatch! Expected ${expectedCount} pill(s) but found ${detectedCount}. Please check the container.`
            ) : (
              `⚠️ The wrong medication was detected! Please check the container and ensure the correct pill is placed.`
            )}
          </Text>
          
          <TouchableOpacity
            style={[styles.stopButton, { backgroundColor: theme.error }]}
            onPress={handleStopBuzzer}
            activeOpacity={0.8}
          >
            <Ionicons name="stop-circle" size={28} color={theme.card} />
            <Text style={[styles.stopButtonText, { color: theme.card }]}>STOP ALARM</Text>
          </TouchableOpacity>
          
          <TouchableOpacity
            style={[styles.dismissButton, { borderColor: theme.border }]}
            onPress={onDismiss}
            activeOpacity={0.7}
          >
            <Text style={[styles.dismissButtonText, { color: theme.textSecondary }]}>Dismiss</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10000,
    elevation: 1000,
  },
  modalContainer: {
    width: '85%',
    borderRadius: 20,
    padding: 30,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 1001,
    zIndex: 10001,
  },
  iconContainer: {
    marginBottom: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 10,
    textAlign: 'center',
  },
  containerText: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 20,
  },
  detailsContainer: {
    width: '100%',
    marginBottom: 20,
    padding: 15,
    borderRadius: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.05)',
  },
  detailLabel: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 5,
  },
  detailValue: {
    fontSize: 16,
    fontWeight: '500',
  },
  warningText: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 25,
    lineHeight: 20,
  },
  stopButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    paddingHorizontal: 40,
    borderRadius: 30,
    minWidth: 220,
    marginBottom: 15,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
  },
  stopButtonText: {
    fontSize: 20,
    fontWeight: 'bold',
    marginLeft: 12,
    letterSpacing: 1,
  },
  dismissButton: {
    paddingVertical: 12,
    paddingHorizontal: 30,
    borderRadius: 20,
    borderWidth: 1,
    minWidth: 150,
  },
  dismissButtonText: {
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
});

export default PillMismatchModal;

