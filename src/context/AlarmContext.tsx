import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import BluetoothService from '@/services/BluetoothService';

interface AlarmState {
  visible: boolean;
  container: number;
  time: string;
  startTime?: number; // Timestamp when alarm started
}

interface AlarmContextType {
  alarmState: AlarmState;
  showAlarm: (container: number, time: string) => void;
  hideAlarm: () => void;
}

const AlarmContext = createContext<AlarmContextType | undefined>(undefined);

export const useGlobalAlarm = () => {
  const context = useContext(AlarmContext);
  if (!context) {
    throw new Error('useGlobalAlarm must be used within AlarmProvider');
  }
  return context;
};

export const AlarmProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [alarmState, setAlarmState] = useState<AlarmState>({
    visible: false,
    container: 1,
    time: '',
  });
  
  const listenerActiveRef = useRef(true);
  const lastAlarmShownRef = useRef<number>(0);
  const alarmStartTimeRef = useRef<number | null>(null);

  const showAlarm = useCallback((container: number, time: string) => {
    const nowTs = Date.now();
    // Prevent rapid successive popups (3s window)
    if (nowTs - lastAlarmShownRef.current < 3000) {
      console.log('[AlarmContext] ⏳ Alarm trigger ignored due to cooldown window');
      return;
    }
    lastAlarmShownRef.current = nowTs;
    
    console.log(`[AlarmContext] 🔔 Showing global alarm: Container ${container} at ${time}`);
    alarmStartTimeRef.current = nowTs; // Track when alarm started
    setAlarmState({
      visible: true,
      container,
      time,
      startTime: nowTs, // Track when alarm started
    });
  }, []);

  const hideAlarm = useCallback(() => {
    const nowTs = Date.now();
    
    // Check if alarm has been visible for at least 2 minutes (120000 ms)
    if (alarmStartTimeRef.current) {
      const elapsed = nowTs - alarmStartTimeRef.current;
      const minDuration = 120000; // 2 minutes in milliseconds
      
      if (elapsed < minDuration) {
        const remainingSeconds = Math.ceil((minDuration - elapsed) / 1000);
        console.log(`[AlarmContext] ⏳ Alarm cannot be dismissed yet. Elapsed: ${Math.floor(elapsed / 1000)}s, Required: 120s, Remaining: ${remainingSeconds}s`);
        // Don't hide - alarm must stay visible for at least 2 minutes
        return;
      }
    }
    
    console.log('[AlarmContext] Hiding alarm');
    alarmStartTimeRef.current = null;
    setAlarmState(prev => ({ ...prev, visible: false, startTime: undefined }));
  }, []);

  // Global Bluetooth listener for alarms
  useEffect(() => {
    console.log('[AlarmContext] Setting up global Bluetooth alarm listener...');
    
    const checkConnection = async () => {
      const isConnected = await BluetoothService.isConnectionActive();
      console.log(`[AlarmContext] Bluetooth connection status: ${isConnected}`);
      if (!isConnected) {
        console.warn('[AlarmContext] ⚠️ Bluetooth is not connected! Alarm messages will not be received.');
      } else {
        console.log('[AlarmContext] ✅ Bluetooth is connected, global listener ready');
      }
    };
    checkConnection();
    
    listenerActiveRef.current = true;
    const cleanup = BluetoothService.onDataReceived(async (data: string) => {
      if (!listenerActiveRef.current) {
        return;
      }
      
      const trimmedData = data.trim();
      console.log(`[AlarmContext] 📱 Received Bluetooth data: "${trimmedData}"`);
      
      // Parse ALARM_TRIGGERED message
      if (trimmedData.includes('ALARM_TRIGGERED')) {
        console.log(`[AlarmContext] ✅ Detected ALARM_TRIGGERED message: "${trimmedData}"`);
        
        const match = trimmedData.match(/ALARM_TRIGGERED\s+C(\d+)\s+(\d{1,2}):(\d{2})/);
        if (match) {
          const container = parseInt(match[1]);
          const hour = match[2].padStart(2, '0');
          const minute = match[3];
          const timeStr = `${hour}:${minute}`;
          
          console.log(`[AlarmContext] 📊 Parsed alarm: Container ${container} at ${timeStr}`);
          
          // Show alarm globally
          showAlarm(container, timeStr);
          
          // Play alarm sound
          try {
            // @ts-expect-error - Dynamic import for lazy loading (works at runtime)
            const { soundService } = await import('@/services/soundService');
            await soundService.initialize();
            await soundService.playAlarmSound('alarm');
          } catch (soundError) {
            console.warn('[AlarmContext] Failed to play alarm sound:', soundError);
          }

          // Show push notification
          try {
            // @ts-expect-error - Dynamic import for lazy loading (works at runtime)
            const Notifications = await import('expo-notifications');
            if (Notifications.default && typeof Notifications.default.scheduleNotificationAsync === 'function') {
              await Notifications.default.scheduleNotificationAsync({
                content: {
                  title: '💊 Medication Reminder',
                  body: `Time to take medication from Container ${container} at ${timeStr}!`,
                  sound: 'default',
                  ...(Platform.OS === 'android' && { priority: 'high' as const }),
                  data: { container, time: timeStr },
                },
                trigger: null,
              });
            }
          } catch (notificationError) {
            console.warn('[AlarmContext] Failed to send notification:', notificationError);
          }
        }
      }
    });
    
    // Handle app state changes
    const handleAppStateChange = (nextAppState: string) => {
      if (nextAppState === 'active') {
        console.log('[AlarmContext] App became active - checking Bluetooth connection');
        checkConnection();
      }
    };
    
    const subscription = AppState.addEventListener('change', handleAppStateChange);
    
    return () => {
      console.log('[AlarmContext] 🧹 Cleaning up global Bluetooth listener...');
      listenerActiveRef.current = false;
      if (cleanup) {
        cleanup();
      }
      subscription?.remove();
    };
  }, [showAlarm]);

  return (
    <AlarmContext.Provider value={{ alarmState, showAlarm, hideAlarm }}>
      {children}
    </AlarmContext.Provider>
  );
};

