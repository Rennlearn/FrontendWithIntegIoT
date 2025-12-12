import React, { useEffect, useState, useRef } from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet, Animated, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { lightTheme, darkTheme } from '@/styles/theme';
import BluetoothService from '@/services/BluetoothService';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface AlarmModalProps {
  visible: boolean;
  container: number;
  time: string;
  onDismiss: () => void;
  onStopAlarm?: (container: number) => Promise<void>;
}

const AlarmModal: React.FC<AlarmModalProps> = ({ visible, container, time, onDismiss, onStopAlarm }) => {
  const { isDarkMode } = useTheme();
  const theme = isDarkMode ? darkTheme : lightTheme;
  const [pulseAnim] = useState(new Animated.Value(1));
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [soundInterval, setSoundInterval] = useState<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number | null>(null);

  useEffect(() => {
    if (visible) {
      // Record start time
      startTimeRef.current = Date.now();
      setElapsedSeconds(0);
      
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
      
      // Start playing alarm sound repeatedly
      const playAlarmSound = async () => {
        try {
          // @ts-expect-error - Dynamic import for lazy loading (works at runtime)
          const { soundService } = await import('@/services/soundService');
          await soundService.initialize();
          await soundService.playAlarmSound('alarm');
        } catch (soundError) {
          console.warn('[AlarmModal] Failed to play alarm sound:', soundError);
        }
      };
      
      // Play immediately
      playAlarmSound();
      
      // Keep playing every 3 seconds for 2 minutes (40 times)
      const interval = setInterval(() => {
        playAlarmSound();
      }, 3000);
      
      setSoundInterval(interval);
      
      // Update elapsed time every second
      const timerInterval = setInterval(() => {
        if (startTimeRef.current) {
          const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
          setElapsedSeconds(elapsed);
        }
      }, 1000);
      
      // Cleanup after 2 minutes (120 seconds)
      const cleanupTimer = setTimeout(() => {
        console.log('[AlarmModal] 2 minutes elapsed - alarm can now be dismissed');
      }, 120000);
      
      return () => {
        clearInterval(interval);
        clearInterval(timerInterval);
        clearTimeout(cleanupTimer);
        setSoundInterval(null);
        startTimeRef.current = null;
        
        // Stop sound when modal closes
        try {
          // @ts-expect-error - Dynamic import for lazy loading (works at runtime)
          import('@/services/soundService').then(({ soundService }) => {
            soundService.stopSound();
          });
        } catch (error) {
          console.warn('[AlarmModal] Failed to stop sound:', error);
        }
      };
    } else {
      // Cleanup when modal is hidden
      if (soundInterval) {
        clearInterval(soundInterval);
        setSoundInterval(null);
      }
      startTimeRef.current = null;
      setElapsedSeconds(0);
    }
  }, [visible]);

  const handleStopAlarm = async () => {
    // Check if alarm has been visible for at least 2 minutes
    if (startTimeRef.current) {
      const elapsed = Date.now() - startTimeRef.current;
      const minDuration = 120000; // 2 minutes in milliseconds
      
      if (elapsed < minDuration) {
        const remainingSeconds = Math.ceil((minDuration - elapsed) / 1000);
        Alert.alert(
          'Alarm Active',
          `The alarm must remain active for at least 2 minutes.\n\nPlease wait ${remainingSeconds} more second(s) before dismissing.`,
          [{ text: 'OK' }]
        );
        return; // Don't allow dismissal yet
      }
    }
    
    try {
      const isConnected = await BluetoothService.isConnectionActive();
      if (isConnected) {
        console.log(`[AlarmModal] Stopping alarm for Container ${container} at ${time}`);
        await BluetoothService.sendCommand('ALARMSTOP\n');
        
        // Mark the schedule as "Done" in the backend
        try {
          const token = await AsyncStorage.getItem('token');
          const headers: HeadersInit = {
            'Content-Type': 'application/json',
          };
          if (token) {
            headers['Authorization'] = `Bearer ${token.trim()}`;
          }
          
          // Find and update the schedule that matches this alarm
          // First, get all schedules to find the matching one
          const schedulesResponse = await fetch('https://pillnow-database.onrender.com/api/medication_schedules', {
            headers
          });
          
          if (schedulesResponse.ok) {
            const schedulesData = await schedulesResponse.json();
            const allSchedules = schedulesData.data || [];
            
            // Find the schedule that matches container and time
            // Try to find active schedule (status: Pending or Active)
            const matchingSchedule = allSchedules.find((sched: any) => {
              const schedContainer = parseInt(sched.container);
              const schedTime = String(sched.time).substring(0, 5); // Get HH:MM format
              const isMatching = schedContainer === container && schedTime === time;
              const isActive = sched.status === 'Pending' || sched.status === 'Active' || !sched.status;
              return isMatching && isActive;
            });
            
            if (matchingSchedule) {
              console.log(`[AlarmModal] Found matching schedule ${matchingSchedule._id}, marking as Done...`);
              
              // Update schedule status to "Done"
              const updateResponse = await fetch(`https://pillnow-database.onrender.com/api/medication_schedules/${matchingSchedule._id}`, {
                method: 'PATCH',
                headers,
                body: JSON.stringify({ status: 'Done' }),
              });
              
              if (updateResponse.ok) {
                console.log(`[AlarmModal] ✅ Schedule ${matchingSchedule._id} marked as Done`);
              } else {
                const errorText = await updateResponse.text();
                console.warn(`[AlarmModal] PATCH failed (${updateResponse.status}): ${errorText}`);
                
                // Try PUT if PATCH doesn't work
                const putResponse = await fetch(`https://pillnow-database.onrender.com/api/medication_schedules/${matchingSchedule._id}`, {
                  method: 'PUT',
                  headers,
                  body: JSON.stringify({ ...matchingSchedule, status: 'Done' }),
                });
                
                if (putResponse.ok) {
                  console.log(`[AlarmModal] ✅ Schedule marked as Done (via PUT)`);
                } else {
                  const putErrorText = await putResponse.text();
                  console.warn(`[AlarmModal] ⚠️ PUT also failed (${putResponse.status}): ${putErrorText}`);
                }
              }
            } else {
              console.warn(`[AlarmModal] ⚠️ Could not find matching active schedule for Container ${container} at ${time}`);
              // Try to find any schedule (even if already Done) for logging
              const anySchedule = allSchedules.find((sched: any) => {
                const schedContainer = parseInt(sched.container);
                const schedTime = String(sched.time).substring(0, 5);
                return schedContainer === container && schedTime === time;
              });
              if (anySchedule) {
                console.log(`[AlarmModal] Found schedule but status is: ${anySchedule.status}`);
              }
            }
          }
        } catch (updateError) {
          console.error('[AlarmModal] Error updating schedule status:', updateError);
          // Don't block the alarm stop if status update fails
        }
        
        // Dismiss modal first
        onDismiss();
        
        // Trigger camera capture / verification if provided (non-blocking)
        if (onStopAlarm) {
          onStopAlarm(container).catch((err) => {
            console.warn('[AlarmModal] onStopAlarm callback failed:', err);
          });
        }
        
        // Show success message that schedule is marked as Done
        setTimeout(() => {
          Alert.alert(
            'Alarm Stopped', 
            'The alarm has been turned off. Schedule marked as Done. Verifying medication...',
            [{ text: 'OK' }]
          );
        }, 500);
      } else {
        onDismiss();
        Alert.alert('Not Connected', 'Bluetooth is not connected. Alarm will stop automatically after 60 seconds.');
      }
    } catch (error) {
      console.error('Error stopping alarm:', error);
      Alert.alert('Error', 'Failed to stop alarm. Please try again.');
    }
  };

  // Debug logging
  useEffect(() => {
    if (visible) {
      console.log(`[AlarmModal] 🚨 Modal is now VISIBLE for Container ${container} at ${time}`);
    } else {
      console.log(`[AlarmModal] Modal is hidden`);
    }
  }, [visible, container, time]);

  // Always render the Modal component, but control visibility with the `visible` prop
  // This ensures React Native can properly show/hide the modal
  // Only log when modal becomes visible to reduce console noise
  useEffect(() => {
    if (visible) {
      console.log(`[AlarmModal] Modal opened - container: ${container}, time: ${time}`);
    }
  }, [visible, container, time]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleStopAlarm}
    >
      <View style={styles.overlay}>
        <View style={[styles.modalContainer, { backgroundColor: theme.card }]}>
          <Animated.View style={[styles.iconContainer, { transform: [{ scale: pulseAnim }] }]}>
            <Ionicons name="alarm" size={80} color={theme.error} />
          </Animated.View>
          
          <Text style={[styles.title, { color: theme.secondary }]}>Time to Take Medication!</Text>
          <Text style={[styles.containerText, { color: theme.text }]}>Container {container}</Text>
          <Text style={[styles.timeText, { color: theme.textSecondary }]}>{time}</Text>
          
          {/* Elapsed time display */}
          {elapsedSeconds < 120 && (
            <View style={[styles.timerContainer, { backgroundColor: theme.error + '20', borderColor: theme.error }]}>
              <Ionicons name="time-outline" size={16} color={theme.error} />
              <Text style={[styles.timerText, { color: theme.error }]}>
                Alarm active: {Math.floor(elapsedSeconds / 60)}:{(elapsedSeconds % 60).toString().padStart(2, '0')} / 2:00
              </Text>
            </View>
          )}
          
          {elapsedSeconds >= 120 && (
            <View style={[styles.timerContainer, { backgroundColor: theme.primary + '20', borderColor: theme.primary }]}>
              <Ionicons name="checkmark-circle-outline" size={16} color={theme.primary} />
              <Text style={[styles.timerText, { color: theme.primary }]}>
                You can now dismiss the alarm
              </Text>
            </View>
          )}
          
          <TouchableOpacity
            style={[styles.stopButton, { backgroundColor: theme.primary }]}
            onPress={handleStopAlarm}
          >
            <Ionicons name="stop-circle" size={24} color={theme.card} />
            <Text style={[styles.stopButtonText, { color: theme.card }]}>Stop Alarm</Text>
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
  },
  modalContainer: {
    width: '85%',
    maxWidth: 400,
    borderRadius: 20,
    padding: 30,
    alignItems: 'center',
    elevation: 10,
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
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 8,
  },
  timeText: {
    fontSize: 16,
    marginBottom: 30,
  },
  stopButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 30,
    paddingVertical: 15,
    borderRadius: 25,
    gap: 10,
    minWidth: 200,
    justifyContent: 'center',
  },
  stopButtonText: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  timerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 15,
    paddingVertical: 8,
    borderRadius: 15,
    borderWidth: 1,
    marginBottom: 20,
    gap: 8,
  },
  timerText: {
    fontSize: 14,
    fontWeight: '600',
  },
});

export default AlarmModal;

