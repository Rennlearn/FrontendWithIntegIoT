import React, { useState, useEffect, useCallback } from 'react';
import { 
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, ActivityIndicator, Platform 
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from './context/ThemeContext';
import { lightTheme, darkTheme } from './styles/theme';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { jwtDecode } from 'jwt-decode';
import BluetoothService from './services/BluetoothService';
import verificationService, { VerificationResult } from './services/verificationService';
import AlarmModal from './components/AlarmModal';

// Interface for decoded JWT token
interface DecodedToken {
  id: string;
  userId: string;
  role?: string;
}

const MonitorManageScreen = () => {
  const navigation = useNavigation();
  const { isDarkMode } = useTheme();
  const theme = isDarkMode ? darkTheme : lightTheme;
  
  // State for schedule data
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [medications, setMedications] = useState<any[]>([]);
  const [schedules, setSchedules] = useState<any[]>([]);
  const [clockTick, setClockTick] = useState<number>(0); // force refresh for status derivation
  const [verifications, setVerifications] = useState<Record<number, VerificationResult>>({});
  const [loadingVerifications, setLoadingVerifications] = useState(false);
  const [schedulesExpanded, setSchedulesExpanded] = useState(true); // Dropdown state
  const [lastArduinoSync, setLastArduinoSync] = useState<number>(0); // Track last sync time
  
  // Alarm modal state
  const [alarmVisible, setAlarmVisible] = useState(false);
  const [alarmContainer, setAlarmContainer] = useState(1);
  const [alarmTime, setAlarmTime] = useState('');

  // Configure notification handler (lazy load)
  // Note: expo-notifications requires a development build, not Expo Go
  useEffect(() => {
    const setupNotifications = async () => {
      try {
        const Notifications = await import('expo-notifications');
        // Check if native module is available
        if (Notifications.default && typeof Notifications.default.setNotificationHandler === 'function') {
          Notifications.default.setNotificationHandler({
            handleNotification: async () => ({
              shouldShowAlert: true,
              shouldPlaySound: true,
              shouldSetBadge: true,
            }),
          });
        }
      } catch (e) {
        console.warn('expo-notifications native module not available, using Alert fallback:', e.message);
      }
    };
    setupNotifications();
  }, []);

  // Load schedule data on component mount and when screen comes into focus
  // NO auto-deletion, NO auto-sync - user must manually sync or delete
  useEffect(() => {
    const loadData = async () => {
      await loadScheduleData(false, false, true); // NO sync to Arduino, NO auto-delete, show loading on initial load
      await loadVerifications();
    };
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  // Load verification results
  const loadVerifications = useCallback(async () => {
    try {
      setLoadingVerifications(true);
      const verificationPromises = [1, 2, 3].map(async (containerNum) => {
        const containerId = verificationService.getContainerId(containerNum);
        const result = await verificationService.getVerificationResult(containerId);
        return { containerNum, result };
      });

      const results = await Promise.all(verificationPromises);
      const verificationMap: Record<number, VerificationResult> = {};
      results.forEach(({ containerNum, result }) => {
        if (result.success) {
          verificationMap[containerNum] = result;
        }
      });
      setVerifications(verificationMap);
    } catch (error) {
      console.error('Error loading verifications:', error);
    } finally {
      setLoadingVerifications(false);
    }
  }, []);

  // Refresh data when screen comes into focus
  // Auto-delete missed schedules, then sync remaining schedules to Arduino
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', async () => {
      await loadScheduleData(true, true, true); // Sync to Arduino AND auto-delete missed schedules, show loading
      await loadVerifications();
    });

    return unsubscribe;
  }, [navigation, loadScheduleData, loadVerifications]);

  // Periodically refresh derived statuses (Pending -> Missed once time passes)
  // Also auto-delete schedules missed for more than 5 minutes
  // Note: We reload data but don't sync to Arduino to avoid constant re-syncing
  useEffect(() => {
    let cycleCount = 0;
    
    // Update clock tick every 10 seconds to trigger status re-derivation
    const statusUpdateInterval = setInterval(() => {
      setClockTick((t) => t + 1);
    }, 10000); // Update every 10 seconds for real-time status changes
    
    // Reload data every 30 seconds
    const dataReloadInterval = setInterval(async () => {
      cycleCount++;
      
      // Every 2 minutes (4 cycles of 30 seconds), run auto-deletion to clean up missed schedules
      const shouldAutoDelete = cycleCount % 4 === 0;
      
      try {
        if (shouldAutoDelete) {
          console.log('[MonitorManageScreen] 🔄 Periodic auto-deletion cycle (every 2 minutes)');
          await loadScheduleData(false, true, false); // Skip Arduino sync, but run auto-deletion, no loading
        } else {
          // Just reload for status updates, no deletion, no loading
          await loadScheduleData(false, false, false); // Pass false to skip Arduino sync, auto-deletion, and loading
        }
      } catch (err) {
        console.warn('[MonitorManageScreen] Error during periodic schedule cleanup:', err);
      }
    }, 30000); // Reload data every 30 seconds
    
    return () => {
      clearInterval(statusUpdateInterval);
      clearInterval(dataReloadInterval);
    };
  }, [loadScheduleData]);

  // Listen for Bluetooth alarm notifications
  useEffect(() => {
    console.log('[MonitorManageScreen] Setting up Bluetooth listener for alarm messages...');
    
    // Check if Bluetooth is connected
    const checkConnection = async () => {
      const isConnected = await BluetoothService.isConnectionActive();
      console.log(`[MonitorManageScreen] Bluetooth connection status: ${isConnected}`);
      if (!isConnected) {
        console.warn('[MonitorManageScreen] ⚠️ Bluetooth is not connected! Alarm messages will not be received.');
        Alert.alert(
          'Bluetooth Not Connected',
          'Please connect to Arduino via Bluetooth to receive alarm notifications.',
          [{ text: 'OK' }]
        );
      } else {
        console.log('[MonitorManageScreen] ✅ Bluetooth is connected, listener ready');
      }
    };
    checkConnection();
    
    let listenerActive = true;
    const cleanup = BluetoothService.onDataReceived(async (data: string) => {
      if (!listenerActive) {
        console.log('[MonitorManageScreen] Listener inactive, ignoring data');
        return;
      }
      
      const trimmedData = data.trim();
      console.log(`[MonitorManageScreen] 📱 Received Bluetooth data: "${trimmedData}"`);
      
      // Parse ALARM_TRIGGERED message: "ALARM_TRIGGERED C1 14:30" or "ALARM_TRIGGERED C1 14:30\n"
      if (trimmedData.includes('ALARM_TRIGGERED')) {
        console.log(`[MonitorManageScreen] ✅ Detected ALARM_TRIGGERED message: "${trimmedData}"`);
        
        // More flexible regex to handle variations
        const match = trimmedData.match(/ALARM_TRIGGERED\s+C(\d+)\s+(\d{1,2}):(\d{2})/);
        if (match) {
          const container = parseInt(match[1]);
          const hour = match[2].padStart(2, '0');
          const minute = match[3];
          const timeStr = `${hour}:${minute}`;
          
          console.log(`[MonitorManageScreen] 📊 Parsed alarm: Container ${container} at ${timeStr}`);
          console.log(`[MonitorManageScreen] 🔔 Setting alarm modal visible...`);
          
          // Prevent duplicate modals - only update if modal is not already visible for this container/time
          if (alarmVisible && alarmContainer === container && alarmTime === timeStr) {
            console.log(`[MonitorManageScreen] ⚠️ Alarm modal already visible for Container ${container} at ${timeStr}, skipping duplicate`);
            return;
          }
          
          // Update state immediately using functional updates to ensure state is set
          setAlarmContainer(container);
          setAlarmTime(timeStr);
          setAlarmVisible(true);
          
          console.log(`[MonitorManageScreen] ✅ Alarm modal state updated - visible: true, container: ${container}, time: ${timeStr}`);
          
          // Automatically trigger ESP32-CAM capture BEFORE user takes pill
          // Use setTimeout to ensure modal state is set first, then trigger capture
          setTimeout(async () => {
            try {
              const containerId = verificationService.getContainerId(container);
              console.log(`[Auto Capture] Alarm triggered for Container ${container}, mapping to containerId: ${containerId}`);
              console.log(`[Auto Capture] Capturing BEFORE pill taken...`);
              
              // Get pill count from backend
              let pillCount = 0;
              try {
                const configResponse = await fetch(`http://10.56.196.91:5001/get-pill-config/${containerId}`, {
                  method: 'GET',
                  headers: { 'Content-Type': 'application/json' },
                  signal: AbortSignal.timeout(5000) // 5 second timeout
                });
                if (configResponse.ok) {
                  const configData = await configResponse.json();
                  pillCount = configData.pill_config?.count || 0;
                  console.log(`[Auto Capture] Got pill count: ${pillCount} for ${containerId}`);
                } else {
                  console.warn(`[Auto Capture] Failed to get pill config: HTTP ${configResponse.status}`);
                }
              } catch (configError) {
                console.warn(`[Auto Capture] Error fetching pill config:`, configError);
                // Continue with pillCount = 0 if config fetch fails
              }
              
              // Trigger capture with retry logic
              console.log(`[Auto Capture] 🎥 Calling triggerCapture for ${containerId} with pill count ${pillCount}...`);
              let captureResult = await verificationService.triggerCapture(containerId, { count: pillCount });
              console.log(`[Auto Capture] 📸 Capture result:`, captureResult);
              
              // Retry once if it fails
              if (!captureResult.ok) {
                console.warn(`[Auto Capture] ⚠️ First capture attempt failed, retrying in 2 seconds...`);
                await new Promise(resolve => setTimeout(resolve, 2000));
                captureResult = await verificationService.triggerCapture(containerId, { count: pillCount });
                console.log(`[Auto Capture] 📸 Retry capture result:`, captureResult);
              }
              
              if (captureResult.ok) {
                console.log(`[Auto Capture] ✅ Pre-pill capture triggered successfully for Container ${container}`);
                // Don't check verification result immediately - just log that capture was triggered
                // The verification will be checked after user takes pill (post-pill capture)
              } else {
                console.error(`[Auto Capture] ❌ Failed to trigger capture after retry: ${captureResult.message}`);
                // Don't show alert here - it might interfere with the alarm modal
                // Just log the error - user can still take the pill
                console.error(`[Auto Capture] Error details: ${captureResult.message}`);
              }
            } catch (error) {
              console.error(`[Auto Capture] ❌ Exception during pre-pill capture for Container ${container}:`, error);
              if (error instanceof Error) {
                console.error(`[Auto Capture] Error details: ${error.message}\n${error.stack}`);
              }
            }
          }, 500); // Small delay to ensure modal state is set first
          
          // Show push notification
          try {
            const Notifications = await import('expo-notifications');
            // Check if native module is available
            if (Notifications.default && typeof Notifications.default.scheduleNotificationAsync === 'function') {
              await Notifications.default.scheduleNotificationAsync({
                content: {
                  title: '💊 Medication Reminder',
                  body: `Time to take medication from Container ${container} at ${timeStr}!`,
                  sound: true,
                  ...(Platform.OS === 'android' && { priority: 'high' as const }),
                  data: { container, time: timeStr },
                },
                trigger: null, // Show immediately
              });
            } else {
              throw new Error('Native module not available');
            }
          } catch (notificationError) {
            console.warn('Failed to send notification, using Alert:', notificationError?.message || notificationError);
            // Fallback to Alert if notification fails
            Alert.alert(
              '💊 Medication Reminder',
              `Time to take medication from Container ${container} at ${timeStr}!`,
              [{ text: 'OK' }]
            );
          }
          
          // Create schedule notification
          try {
            const notificationResponse = await fetch('http://10.56.196.91:5001/notifications/schedule', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                type: 'alarm_triggered',
                container: `container${container}`,
                message: `Alarm triggered for Container ${container} at ${timeStr}`,
                scheduleId: null
              })
            });
            if (notificationResponse.ok) {
              console.log('[MonitorManageScreen] ✅ Created schedule notification for alarm trigger');
            }
          } catch (notifErr) {
            console.warn('[MonitorManageScreen] Failed to create schedule notification:', notifErr);
          }
          
          // Reload schedule data to update status (mark as "Active" or remove if needed)
          setTimeout(async () => {
            console.log('[MonitorManageScreen] Reloading schedules after alarm trigger...');
            try {
              await loadScheduleData(false, false, false); // Don't sync to Arduino, don't auto-delete, no loading
            } catch (err) {
              console.warn('[MonitorManageScreen] Error reloading schedules after alarm:', err);
            }
          }, 1000);
        }
      }
      
      // Parse ALARM_STOPPED message: "ALARM_STOPPED C1" (after user takes pill)
      // Also handle "ALARM_STOPPED" without container (fallback)
      if (data.includes('ALARM_STOPPED')) {
        console.log(`[MonitorManageScreen] ✅ Detected ALARM_STOPPED message: "${data}"`);
        let container = 0;
        const match = data.match(/ALARM_STOPPED C(\d+)/);
        if (match) {
          container = parseInt(match[1]);
        } else {
          // If no container in message, use the last known alarm container
          container = alarmContainer;
          console.log(`[MonitorManageScreen] No container in ALARM_STOPPED message, using last known: ${container}`);
        }
        
        if (container > 0) {
          console.log(`[Auto Capture] Alarm stopped for Container ${container}, capturing AFTER pill taken...`);
          
          // Dismiss alarm modal immediately when ALARM_STOPPED is received
          // This prevents duplicate modals
          setAlarmVisible(false);
          console.log('[MonitorManageScreen] Dismissed alarm modal on ALARM_STOPPED');
          
          // Send notification that pill was taken
          try {
            const Notifications = await import('expo-notifications');
            if (Notifications.default && typeof Notifications.default.scheduleNotificationAsync === 'function') {
              await Notifications.default.scheduleNotificationAsync({
                content: {
                  title: '✅ Pill Taken',
                  body: `Verifying medication in Container ${container}...`,
                  sound: false,
                  ...(Platform.OS === 'android' && { priority: 'default' as const }),
                  data: { container, action: 'pill_taken' },
                },
                trigger: null, // Show immediately
              });
            }
          } catch (notificationError) {
            console.warn('Failed to send notification:', notificationError?.message || notificationError);
          }
          
          // Create schedule notification for alarm stopped
          try {
            const notificationResponse = await fetch('http://10.56.196.91:5001/notifications/schedule', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                type: 'alarm_stopped',
                container: `container${container}`,
                message: `Alarm stopped for Container ${container}. Verifying medication...`,
                scheduleId: null
              })
            });
            if (notificationResponse.ok) {
              console.log('[MonitorManageScreen] ✅ Created schedule notification for alarm stopped');
            }
          } catch (notifErr) {
            console.warn('[MonitorManageScreen] Failed to create schedule notification:', notifErr);
          }
          
          // Automatically trigger ESP32-CAM capture AFTER user takes pill
          try {
            const containerId = verificationService.getContainerId(container);
            console.log(`[Auto Capture] Alarm stopped for Container ${container}, mapping to containerId: ${containerId}`);
            console.log(`[Auto Capture] Capturing AFTER pill taken...`);
            
            // Get pill count from backend
            let pillCount = 0;
            try {
              const configResponse = await fetch(`http://10.56.196.91:5001/get-pill-config/${containerId}`);
              if (configResponse.ok) {
                const configData = await configResponse.json();
                pillCount = configData.pill_config?.count || 0;
                console.log(`[Auto Capture] Got pill count: ${pillCount} for ${containerId}`);
              } else {
                console.warn(`[Auto Capture] Failed to get pill config: ${configResponse.status}`);
              }
            } catch (configError) {
              console.warn(`[Auto Capture] Error fetching pill config:`, configError);
            }
            
            // Trigger capture with retry logic (same as pre-pill)
            console.log(`[Auto Capture] Calling triggerCapture for ${containerId} with pill count ${pillCount}...`);
            let captureResult = await verificationService.triggerCapture(containerId, { count: pillCount });
            console.log(`[Auto Capture] Post-pill capture result:`, captureResult);
            
            // Retry up to 2 more times if it fails
            let retryCount = 0;
            const maxRetries = 2;
            while (!captureResult.ok && retryCount < maxRetries) {
              retryCount++;
              console.warn(`[Auto Capture] ⚠️ Post-pill capture attempt ${retryCount} failed, retrying in ${retryCount * 2} seconds...`);
              await new Promise(resolve => setTimeout(resolve, retryCount * 2000));
              captureResult = await verificationService.triggerCapture(containerId, { count: pillCount });
              console.log(`[Auto Capture] 📸 Post-pill retry ${retryCount} result:`, captureResult);
            }
            
            if (captureResult.ok) {
              console.log(`[Auto Capture] ✅ Post-pill capture triggered successfully for Container ${container}`);
              
              // Wait a bit and check result
              setTimeout(async () => {
                const result = await verificationService.getVerificationResult(containerId);
                console.log(`[Auto Capture] Post-pill verification result:`, result);
                
                // Send verification result notification (alarm modal is already dismissed)
                try {
                  const Notifications = await import('expo-notifications');
                  if (Notifications.default && typeof Notifications.default.scheduleNotificationAsync === 'function') {
                    const verificationStatus = result.success && result.result?.pass_ ? '✅ Verified' : '⚠️ Verification Failed';
                    await Notifications.default.scheduleNotificationAsync({
                      content: {
                        title: verificationStatus,
                        body: result.success && result.result?.pass_ 
                          ? `Container ${container} medication verified successfully!`
                          : `Container ${container} verification failed. Please check the medication.`,
                        sound: result.success && result.result?.pass_,
                        ...(Platform.OS === 'android' && { priority: 'default' as const }),
                        data: { container, verificationResult: result },
                      },
                      trigger: null,
                    });
                  } else {
                    throw new Error('Native module not available');
                  }
                } catch (notificationError) {
                  console.warn('Failed to send verification notification, using Alert:', notificationError?.message || notificationError);
                  // Only show alert if verification passed - don't show failure alert (too intrusive)
                  if (result.success && result.result?.pass_) {
                    Alert.alert(
                      '✅ Verified',
                      `Container ${container} medication verified successfully!`
                    );
                  } else {
                    // Don't show failure alert - just log it
                    console.log(`[MonitorManageScreen] Verification result: ${result.success ? 'Failed verification' : 'No result'}`);
                  }
                }
                
                // Reload verifications to show updated status
                await loadVerifications();
                
                // Also reload schedules to update status after pill taken
                try {
                  await loadScheduleData(false, false, false); // Don't sync to Arduino, don't auto-delete, no loading
                } catch (err) {
                  console.warn('[MonitorManageScreen] Error reloading schedules after post-pill capture:', err);
                }
              }, 3000); // Reduced from 5000ms to 3000ms for faster feedback
            } else {
              console.error(`[Auto Capture] ❌ Failed to trigger capture: ${captureResult.message}`);
            }
          } catch (error) {
            console.error(`[Auto Capture] ❌ Exception during post-pill capture for Container ${container}:`, error);
            if (error instanceof Error) {
              console.error(`[Auto Capture] Error details: ${error.message}\n${error.stack}`);
            }
          }
        } else {
          console.warn(`[MonitorManageScreen] ALARM_STOPPED received but container is 0, skipping capture`);
        }
      }
    });
    
    // Log when listener is set up
    console.log('[MonitorManageScreen] ✅ Bluetooth listener registered');
    
    return () => {
      console.log('[MonitorManageScreen] 🧹 Cleaning up Bluetooth listener...');
      listenerActive = false; // Mark listener as inactive
      // Cleanup should be synchronous and not block navigation
      try {
        if (cleanup) {
          cleanup();
        }
      } catch (err) {
        console.warn('[MonitorManageScreen] Error during cleanup:', err);
      }
    };
  }, [loadVerifications, loadScheduleData]);

  // Get current user ID and role from JWT token
  const getCurrentUserId = async (): Promise<number> => {
    try {
      const token = await AsyncStorage.getItem('token');
      
      if (!token) {
        console.warn('No token found, using default user ID 1');
        return 1;
      }

      const decodedToken = jwtDecode<DecodedToken>(token.trim());
      const rawId = decodedToken.userId ?? decodedToken.id;
      const userId = parseInt(rawId);
      
      if (isNaN(userId)) {
        console.warn('Invalid user ID in token, using default user ID 1');
        return 1;
      }

      // Get user role from AsyncStorage (stored during login)
      const storedUserRole = await AsyncStorage.getItem('userRole');
      
      // Check if user role allows Elder access (role 2 for Elder based on login screen)
      const userRole = decodedToken.role?.toString() || storedUserRole;
      
      // Allow access if role is 2 (Elder) or if no role restriction is set
      if (userRole && userRole !== "2") {
        console.warn('User role is not Elder (role != 2):', userRole);
        Alert.alert('Access Denied', 'Only Elders can set up medication schedules.');
        throw new Error('Only Elders can set up medication schedules');
      }

      return userId;
    } catch (error) {
      console.error('Error getting user ID from token:', error);
      if (error instanceof Error && error.message.includes('Only Elders')) {
        throw error; // Re-throw role-based errors
      }
      return 1; // Default fallback for other errors
    }
  };

  // Get selected elder ID for caregivers
  const getSelectedElderId = async (): Promise<string | null> => {
    try {
      const selectedElderId = await AsyncStorage.getItem('selectedElderId');
      return selectedElderId;
    } catch (error) {
      console.error('Error getting selected elder ID:', error);
      return null;
    }
  };

  // Get latest schedule ID
  const getLatestScheduleId = async (): Promise<number> => {
    try {
      const token = await AsyncStorage.getItem('token');
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'If-Modified-Since': '0'
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token.trim()}`;
      }
      const response = await fetch('https://pillnow-database.onrender.com/api/medication_schedules', {
        headers
      });
      const data = await response.json();
      const allSchedules = data.data || [];
      
      if (allSchedules.length === 0) {
        return 0; // No schedules exist
      }
      
      // Find the highest schedule ID
      const highestScheduleId = Math.max(...allSchedules.map((schedule: any) => schedule.scheduleId));
      return highestScheduleId;
    } catch (error) {
      console.error('Error getting latest schedule ID:', error);
      return 0;
    }
  };

  // Load schedule data
  const loadScheduleData = useCallback(async (syncToArduino: boolean = true, autoDeleteMissed: boolean = true, showLoading: boolean = true) => {
    try {
      if (showLoading) {
        setLoading(true);
      }
      setError(null);
      
      // Get current user ID
      const currentUserId = await getCurrentUserId();
      
      // Fetch medications and schedules with cache-busting to ensure fresh data
      const medicationsResponse = await fetch('https://pillnow-database.onrender.com/api/medications', {
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
          'If-Modified-Since': '0'
        }
      });
      const medicationsData = await medicationsResponse.json();
      
      // Normalize medications to an array regardless of API wrapper shape
      const medsArray = Array.isArray(medicationsData) ? medicationsData : (medicationsData?.data || []);
      
      const token = await AsyncStorage.getItem('token');
      const scheduleHeaders: HeadersInit = {
        'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
          'If-Modified-Since': '0'
      };
      if (token) {
        scheduleHeaders['Authorization'] = `Bearer ${token.trim()}`;
        }
      const schedulesResponse = await fetch('https://pillnow-database.onrender.com/api/medication_schedules', {
        headers: scheduleHeaders
      });
      const schedulesData = await schedulesResponse.json();
      
      // Get all schedules and filter by current user ID or selected elder ID
      const allSchedules = schedulesData.data || [];
      
      // Check if there's a selected elder (for caregivers)
      const selectedElderId = await getSelectedElderId();
      
      // Filter schedules based on user role and selected elder
      let userSchedules;
      if (selectedElderId) {
        // If caregiver has selected an elder, show that elder's schedules
        userSchedules = allSchedules.filter((schedule: any) => {
          const scheduleUserId = parseInt(schedule.user);
          return scheduleUserId === parseInt(selectedElderId);
        });
      } else {
        // Otherwise, show current user's schedules
        userSchedules = allSchedules.filter((schedule: any) => {
          const scheduleUserId = parseInt(schedule.user);
          return scheduleUserId === currentUserId;
        });
      }
      
      // Automatically delete schedules that have been missed for more than 5 minutes
      // Only do this on initial load or manual refresh, not on periodic refresh to avoid constant deletion
      const now = new Date();
      const fiveMinutesAgo = now.getTime() - (5 * 60 * 1000); // 5 minutes in milliseconds
      
      if (autoDeleteMissed) {
        const schedulesToDelete: any[] = [];
        
        userSchedules.forEach((schedule: any) => {
          if (!schedule?.date || !schedule?.time) return;
          
          try {
            const [y, m, d] = String(schedule.date).split('-').map(Number);
            const [hh, mm] = String(schedule.time).split(':').map(Number);
            const scheduleTime = new Date(y, (m || 1) - 1, d, hh, mm);
            const scheduleTimeMs = scheduleTime.getTime();
            
            // Delete schedules that are:
            // 1. Missed (time has passed) and missed for more than 5 minutes, OR
            // 2. Marked as "Done" and the schedule time was more than 5 minutes ago
            const isMissed = scheduleTimeMs < now.getTime() && scheduleTimeMs < fiveMinutesAgo;
            const isDone = schedule.status === 'Done' && scheduleTimeMs < fiveMinutesAgo;
            
            if (isMissed || isDone) {
              schedulesToDelete.push(schedule);
            }
          } catch (err) {
            console.warn(`[MonitorManageScreen] Error checking schedule time for deletion:`, err);
          }
        });
        
        if (schedulesToDelete.length > 0) {
          const missedCount = schedulesToDelete.filter(s => s.status !== 'Done').length;
          const doneCount = schedulesToDelete.filter(s => s.status === 'Done').length;
          console.log(`[MonitorManageScreen] Auto-deleting ${schedulesToDelete.length} schedule(s): ${missedCount} missed, ${doneCount} done (all older than 5 minutes)`);
          
          // Delete in batches - try to delete all, gracefully handle failures
          const batchSize = 10;
          let deletedCount = 0;
          let failedCount = 0;
          const deletedIds = new Set<string>();
          
          for (let i = 0; i < schedulesToDelete.length; i += batchSize) {
            const batch = schedulesToDelete.slice(i, i + batchSize);
            const deletePromises = batch.map(async (sched: any) => {
              try {
                const response = await fetch(`https://pillnow-database.onrender.com/api/medication_schedules/${sched._id}`, {
                  method: 'DELETE',
                  headers: scheduleHeaders
                });
                
                if (response.ok) {
                  deletedCount++;
                  deletedIds.add(sched._id);
                  return { success: true, id: sched._id };
                } else {
                  const errorText = await response.text();
                  // If it's a validation error (invalid scheduleId), skip it gracefully
                  if (response.status === 500 && errorText.includes('scheduleId') && (errorText.includes('NaN') || errorText.includes('Cast to Number'))) {
                    console.warn(`[MonitorManageScreen] ⚠️ Skipping schedule ${sched._id} - backend validation error (invalid scheduleId). This schedule needs manual cleanup.`);
                    failedCount++;
                    return { success: false, id: sched._id, error: 'Invalid scheduleId - skipped', skip: true };
                  }
                  console.error(`[MonitorManageScreen] Failed to delete schedule ${sched._id}: HTTP ${response.status} - ${errorText.substring(0, 100)}`);
                  failedCount++;
                  return { success: false, id: sched._id, error: `HTTP ${response.status}` };
                }
              } catch (err) {
                console.error(`[MonitorManageScreen] Failed to delete schedule ${sched._id}:`, err);
                failedCount++;
                return { success: false, id: sched._id, error: err instanceof Error ? err.message : 'Unknown error' };
              }
            });
            
            const results = await Promise.all(deletePromises);
            const successCount = results.filter(r => r.success).length;
            const failCount = results.filter(r => !r.success).length;
            console.log(`[MonitorManageScreen] Batch ${Math.floor(i / batchSize) + 1}: ${successCount} deleted, ${failCount} failed`);
            
            // Small delay between batches to avoid overwhelming the backend
            if (i + batchSize < schedulesToDelete.length) {
              await new Promise(resolve => setTimeout(resolve, 200));
            }
          }
          
          console.log(`[MonitorManageScreen] ✅ Auto-deletion complete: ${deletedCount} deleted, ${failedCount} failed out of ${schedulesToDelete.length} total`);
          
          // If deletion failed, log details (but don't block the process)
          if (failedCount > 0) {
            console.warn(`[MonitorManageScreen] ⚠️ ${failedCount} schedule(s) failed to delete (likely due to invalid scheduleId). They won't be synced to Arduino.`);
          }
          
          // Remove successfully deleted schedules from the list
          // Failed schedules stay in userSchedules but won't be synced (they'll be filtered naturally)
          userSchedules = userSchedules.filter((s: any) => !deletedIds.has(s._id));
          
          // Wait a moment for backend to process deletions before continuing
          if (deletedCount > 0) {
            await new Promise(resolve => setTimeout(resolve, 500));
            console.log(`[MonitorManageScreen] ✅ Deleted ${deletedCount} schedule(s) (missed/done), ${userSchedules.length} valid schedule(s) remaining`);
          }
        }
      }
      
      // Group schedules by container - keep ALL schedules for each container
      // Filter out schedules with invalid scheduleId AND missed schedules that failed to delete
      const schedulesByContainer: Record<number, any[]> = {};
      
      userSchedules.forEach((schedule: any) => {
        // Only include schedules with valid scheduleId for syncing
        const scheduleId = schedule.scheduleId;
        const hasValidScheduleId = scheduleId !== null && scheduleId !== undefined && !isNaN(Number(scheduleId)) && Number(scheduleId) > 0;
        
        // If scheduleId is invalid, skip it (it can't be synced anyway)
        if (!hasValidScheduleId) {
          console.warn(`[MonitorManageScreen] Skipping schedule ${schedule._id} from sync - invalid scheduleId: ${scheduleId}`);
          return;
        }
        
        // Also skip missed schedules (even if they have valid scheduleId) - they should have been deleted
        if (schedule?.date && schedule?.time) {
          try {
            const [y, m, d] = String(schedule.date).split('-').map(Number);
            const [hh, mm] = String(schedule.time).split(':').map(Number);
            const scheduleTime = new Date(y, (m || 1) - 1, d, hh, mm);
            const scheduleTimeMs = scheduleTime.getTime();
            
            // If schedule is missed for more than 5 minutes, skip it (don't sync to Arduino)
            if (scheduleTimeMs < now.getTime() && scheduleTimeMs < fiveMinutesAgo) {
              // Don't log individual warnings - too verbose. These will be deleted on next auto-deletion cycle.
              return;
            }
          } catch (err) {
            // Silent skip for invalid date/time
            return;
          }
        }
        
        const containerNum = parseInt(schedule.container) || 1;
        if (!schedulesByContainer[containerNum]) {
          schedulesByContainer[containerNum] = [];
        }
        schedulesByContainer[containerNum].push(schedule);
      });
      
      // Get ALL schedules for each container (not just the latest)
      // IMPORTANT: Filter out missed schedules (>5 minutes old) before syncing to Arduino
      const allSchedulesByContainer: any[] = [];
      
      for (let containerNum = 1; containerNum <= 3; containerNum++) {
        const containerSchedules = schedulesByContainer[containerNum] || [];
        if (containerSchedules.length > 0) {
          // Filter out missed schedules (>5 minutes old) - don't sync them to Arduino
          let missedCount = 0;
          const activeSchedules = containerSchedules.filter((schedule: any) => {
            if (!schedule?.date || !schedule?.time) return true; // Keep schedules without date/time
            
            try {
              const [y, m, d] = String(schedule.date).split('-').map(Number);
              const [hh, mm] = String(schedule.time).split(':').map(Number);
              const scheduleTime = new Date(y, (m || 1) - 1, d, hh, mm);
              const scheduleTimeMs = scheduleTime.getTime();
              
              // Skip if missed for more than 5 minutes
              if (scheduleTimeMs < now.getTime() && scheduleTimeMs < fiveMinutesAgo) {
                missedCount++;
                return false;
              }
              return true;
            } catch (err) {
              return true; // Keep if we can't parse the time
            }
          });
          
          // Log summary instead of individual warnings
          if (missedCount > 0) {
            console.log(`[MonitorManageScreen] ⏭️ Filtered out ${missedCount} missed schedule(s) from Container ${containerNum} (older than 5 minutes, will be deleted on next cycle)`);
          }
          
          if (activeSchedules.length > 0) {
            // Sort by scheduleId (highest first) to show most recent first
            const sortedContainerSchedules = activeSchedules
              .sort((a: any, b: any) => b.scheduleId - a.scheduleId);
            // Add ALL active (non-missed) schedules for this container
            allSchedulesByContainer.push(...sortedContainerSchedules);
          }
        }
      }
      
      // Sort by container number first, then by scheduleId (highest first)
      const sortedSchedules = allSchedulesByContainer.sort((a: any, b: any) => {
          const containerA = parseInt(a.container);
          const containerB = parseInt(b.container);
        if (containerA !== containerB) {
          return containerA - containerB;
        }
        // If same container, sort by scheduleId (highest first)
        return b.scheduleId - a.scheduleId;
        });
      
      setMedications(medsArray);
      setSchedules(sortedSchedules);
      
      // Log summary of loaded schedules
      console.log(`[MonitorManageScreen] ✅ Loaded ${sortedSchedules.length} active schedule(s) from backend (missed schedules filtered out):`);
      sortedSchedules.forEach((sched, index) => {
        console.log(`  [${index + 1}] Container ${sched.container} - ${sched.time} (Schedule ID: ${sched.scheduleId || sched._id || 'N/A'})`);
      });

      // Also sync current schedules to Arduino over Bluetooth if connected
      // IMPORTANT: Sync happens AFTER deletion, so sortedSchedules only contains remaining (non-deleted) schedules
      // Only sync if explicitly requested (not during periodic refresh)
      // Also prevent syncing if we just synced recently (within last 10 seconds)
      if (syncToArduino) {
        const now = Date.now();
        const timeSinceLastSync = now - lastArduinoSync;
        const MIN_SYNC_INTERVAL = 10000; // 10 seconds minimum between syncs
        
        if (timeSinceLastSync < MIN_SYNC_INTERVAL) {
          console.log(`[MonitorManageScreen] Skipping Arduino sync - last sync was ${Math.round(timeSinceLastSync / 1000)}s ago`);
        } else {
      try {
        const isActive = await BluetoothService.isConnectionActive();
        if (isActive && sortedSchedules.length > 0) {
              console.log(`[MonitorManageScreen] Syncing ${sortedSchedules.length} schedule(s) to Arduino...`);
              setLastArduinoSync(now);
              
              // Send each schedule with its container number
          await BluetoothService.sendCommand('SCHED CLEAR\n');
              await new Promise(resolve => setTimeout(resolve, 300)); // Increased delay
              
              for (const sched of sortedSchedules) {
                const containerNum = parseInt(sched.container) || 1;
                console.log(`[MonitorManageScreen] Sending to Arduino: SCHED ADD ${sched.time} ${containerNum}`);
                await BluetoothService.sendCommand(`SCHED ADD ${sched.time} ${containerNum}\n`);
                await new Promise(resolve => setTimeout(resolve, 300)); // Increased delay for reliability
              }
              console.log(`[MonitorManageScreen] ✅ Successfully synced ${sortedSchedules.length} schedule(s) to Arduino`);
        } else if (isActive && sortedSchedules.length === 0) {
          // Clear Arduino if no schedules remain (after deletion)
          console.log('[MonitorManageScreen] No schedules remaining after deletion, clearing Arduino schedules...');
          await BluetoothService.sendCommand('SCHED CLEAR\n');
          await new Promise(resolve => setTimeout(resolve, 300));
          console.log('[MonitorManageScreen] ✅ Arduino schedules cleared.');
          setLastArduinoSync(now);
        }
      } catch (e) {
        console.warn('Bluetooth sync skipped:', e);
          }
        }
      }
      
    } catch (err) {
      console.error('Error loading schedule data:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to load schedule data';
      setError(errorMessage);
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  }, []);

  // Manual refresh function
  // Auto-delete missed schedules, then sync remaining schedules to Arduino
  const handleRefresh = async () => {
    await loadScheduleData(true, true, true); // Sync to Arduino AND auto-delete missed schedules, show loading
    await loadVerifications();
  };

  // Delete all schedules function
  const deleteAllSchedules = async () => {
    if (schedules.length === 0) {
      Alert.alert('No Schedules', 'There are no schedules to delete.');
      return;
    }

    Alert.alert(
      'Delete All Schedules',
      `Are you sure you want to delete all ${schedules.length} schedule(s)? This action cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete All',
          style: 'destructive',
          onPress: async () => {
            try {
              setLoading(true);
              const token = await AsyncStorage.getItem('token');
              const headers: HeadersInit = {
                'Content-Type': 'application/json',
              };
              if (token) {
                headers['Authorization'] = `Bearer ${token.trim()}`;
              }

              // Delete all schedules in batches
              const batchSize = 10;
              let deletedCount = 0;
              let failedCount = 0;
              const failedDeletions: Array<{ id: string, error: string }> = [];
              
              console.log(`[MonitorManageScreen] Starting deletion of ${schedules.length} schedule(s)...`);
              
              for (let i = 0; i < schedules.length; i += batchSize) {
                const batch = schedules.slice(i, i + batchSize);
                console.log(`[MonitorManageScreen] Processing batch ${Math.floor(i / batchSize) + 1}: ${batch.length} schedule(s)`);
                
                const deletePromises = batch.map(async (schedule) => {
                  // Validate schedule ID
                  if (!schedule._id || typeof schedule._id !== 'string') {
                    console.error(`[MonitorManageScreen] Invalid schedule ID:`, schedule);
                    return { success: false, id: schedule._id || 'unknown', error: 'Invalid schedule ID' };
                  }
                  
                  try {
                    const deleteUrl = `https://pillnow-database.onrender.com/api/medication_schedules/${schedule._id}`;
                    console.log(`[MonitorManageScreen] Deleting schedule ${schedule._id} from ${deleteUrl}`);
                    
                    const response = await fetch(deleteUrl, {
                      method: 'DELETE',
                      headers
                    });
                    
                    const responseText = await response.text();
                    console.log(`[MonitorManageScreen] Delete response for ${schedule._id}: HTTP ${response.status} - ${responseText.substring(0, 200)}`);
                    
                    if (response.ok) {
                      console.log(`[MonitorManageScreen] ✅ Successfully deleted schedule ${schedule._id}`);
                      return { success: true, id: schedule._id };
                    } else {
                      // Handle specific error cases
                      let errorMsg = `HTTP ${response.status}`;
                      if (response.status === 401) {
                        errorMsg = 'Unauthorized - token may be expired';
                      } else if (response.status === 404) {
                        errorMsg = 'Schedule not found (may already be deleted)';
                        // Treat 404 as success since the goal is to remove it
                        console.log(`[MonitorManageScreen] ✅ Schedule ${schedule._id} already deleted (404)`);
                        return { success: true, id: schedule._id, error: 'Already deleted' };
                      } else if (response.status === 500) {
                        errorMsg = `Server error: ${responseText.substring(0, 100)}`;
                      }
                      
                      console.error(`[MonitorManageScreen] ❌ Failed to delete schedule ${schedule._id}: ${errorMsg}`);
                      console.error(`[MonitorManageScreen] Full error response: ${responseText}`);
                      return { success: false, id: schedule._id, error: errorMsg };
                    }
                  } catch (err) {
                    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
                    console.error(`[MonitorManageScreen] ❌ Exception deleting schedule ${schedule._id}:`, err);
                    return { success: false, id: schedule._id, error: errorMessage };
                  }
                });

                const results = await Promise.all(deletePromises);
                
                // Count successes and failures from results (don't increment inside callbacks)
                const batchSuccess = results.filter(r => r.success).length;
                const batchFailed = results.filter(r => !r.success).length;
                deletedCount += batchSuccess;
                failedCount += batchFailed;
                
                // Collect failed deletion details
                const batchFailedDetails = results.filter(r => !r.success).map(r => ({ id: r.id, error: r.error }));
                failedDeletions.push(...batchFailedDetails);
                
                console.log(`[MonitorManageScreen] Batch ${Math.floor(i / batchSize) + 1} complete: ${batchSuccess} deleted, ${batchFailed} failed (Total: ${deletedCount} deleted, ${failedCount} failed)`);
                
                // Log failed deletions with details
                batchFailedDetails.forEach(r => {
                  console.warn(`[MonitorManageScreen] Failed deletion: ${r.id} - ${r.error}`);
                });
                
                // Small delay between batches
                if (i + batchSize < schedules.length) {
                  await new Promise(resolve => setTimeout(resolve, 200));
                }
              }

              console.log(`[MonitorManageScreen] ✅ Deletion complete: ${deletedCount} deleted, ${failedCount} failed out of ${schedules.length} total`);
              
              if (failedDeletions.length > 0) {
                console.warn(`[MonitorManageScreen] Failed deletions details:`, failedDeletions);
              }

              // Clear Arduino schedules
              try {
                const isBluetoothActive = await BluetoothService.isConnectionActive();
                if (isBluetoothActive) {
                  await BluetoothService.sendCommand('SCHED CLEAR\n');
                  await new Promise(resolve => setTimeout(resolve, 300));
                  console.log('[MonitorManageScreen] ✅ Cleared all schedules from Arduino');
                } else {
                  console.warn('[MonitorManageScreen] Bluetooth not active, skipping Arduino clear');
                }
              } catch (btErr) {
                console.warn('[MonitorManageScreen] Bluetooth schedule clear failed:', btErr);
              }

              // Reload schedules to reflect deletions
              console.log('[MonitorManageScreen] Reloading schedules after deletion...');
              await loadScheduleData(true, false, false); // Sync to Arduino, no auto-delete, no loading
              await loadVerifications();
              
              // Show appropriate alert based on results
              if (failedCount === 0 && deletedCount > 0) {
                Alert.alert('Success', `All ${deletedCount} schedule(s) deleted successfully!`);
              } else if (deletedCount > 0 && failedCount > 0) {
                const errorSummary = failedDeletions.slice(0, 3).map(f => `- ${f.id}: ${f.error}`).join('\n');
                const moreErrors = failedDeletions.length > 3 ? `\n... and ${failedDeletions.length - 3} more` : '';
                Alert.alert(
                  'Partial Success', 
                  `${deletedCount} schedule(s) deleted, ${failedCount} failed.\n\nErrors:\n${errorSummary}${moreErrors}\n\nCheck console logs for full details.`
                );
              } else if (failedCount > 0 && deletedCount === 0) {
                const errorSummary = failedDeletions.slice(0, 3).map(f => `- ${f.id}: ${f.error}`).join('\n');
                const moreErrors = failedDeletions.length > 3 ? `\n... and ${failedDeletions.length - 3} more` : '';
                Alert.alert(
                  'Deletion Failed', 
                  `Failed to delete all ${failedCount} schedule(s).\n\nErrors:\n${errorSummary}${moreErrors}\n\nPossible causes:\n- Invalid schedule IDs\n- Authentication expired (401)\n- Server error (500)\n\nCheck console logs for details.`
                );
              } else {
                Alert.alert('No Schedules', 'No schedules were found to delete.');
              }
            } catch (err) {
              console.error('Error deleting all schedules:', err);
              Alert.alert('Error', `Failed to delete all schedules: ${err instanceof Error ? err.message : 'Unknown error'}`);
            } finally {
              setLoading(false);
            }
          }
        }
      ]
    );
  };

  // Get container schedules
  const getContainerSchedules = (): Record<number, { pill: string | null, alarms: Date[] }> => {
    const containerSchedules: Record<number, { pill: string | null, alarms: Date[] }> = {
      1: { pill: null, alarms: [] },
      2: { pill: null, alarms: [] },
      3: { pill: null, alarms: [] }
    };
    
    if (!schedules.length || !medications.length) {
      return containerSchedules;
    }
    
    // Group schedules by container
    const schedulesByContainer: Record<number, any[]> = {};
    schedules.forEach((schedule: any) => {
      const containerNum = parseInt(schedule.container) || 1;
      if (!schedulesByContainer[containerNum]) {
        schedulesByContainer[containerNum] = [];
      }
      schedulesByContainer[containerNum].push(schedule);
    });
    
    // Process each container
    for (let containerNum = 1; containerNum <= 3; containerNum++) {
      const containerSchedulesList = schedulesByContainer[containerNum] || [];
      
      if (containerSchedulesList.length > 0) {
        const firstSchedule = containerSchedulesList[0];
        const medicationId = firstSchedule.medication;
        
        // Find medication name from ID
        const medication = medications.find(med => med.medId === medicationId);
        const medicationName = medication ? medication.name : `ID: ${medicationId}`;
        
        containerSchedules[containerNum] = {
          pill: medicationName,
          alarms: containerSchedulesList.map((schedule: any) => {
            const dateStr = schedule.date;
            const timeStr = schedule.time;
            // Create date in local timezone instead of UTC
            const [year, month, day] = dateStr.split('-').map(Number);
            const [hours, minutes] = timeStr.split(':').map(Number);
            return new Date(year, month - 1, day, hours, minutes);
          })
        };
      }
    }
    
    return containerSchedules;
  };

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.primary} />
          <Text style={[styles.loadingText, { color: theme.text }]}>Loading...</Text>
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <View style={styles.errorContainer}>
          <Text style={[styles.errorText, { color: theme.text }]}>{error}</Text>
          <TouchableOpacity 
            style={[styles.retryButton, { backgroundColor: theme.primary }]}
            onPress={loadScheduleData}
          >
            <Text style={[styles.retryButtonText, { color: theme.card }]}>Retry</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const containerSchedules = getContainerSchedules();

  // Helper to derive status locally without mutating backend
  // Mark as "Missed" if it's been more than 1 minute past the scheduled time
  const deriveStatus = (schedule: any): 'Pending' | 'Missed' | 'Taken' | string => {
    const rawStatus = (schedule?.status || 'Pending') as string;
    
    // If already marked as Done, show as Taken
    if (rawStatus.toLowerCase() === 'done') {
      return 'Taken';
    }
    
    // If already marked as Missed, keep it as Missed
    if (rawStatus.toLowerCase() === 'missed') {
      return 'Missed';
    }
    
    if (!schedule?.date || !schedule?.time) return rawStatus || 'Pending';
    
    try {
      const [y, m, d] = String(schedule.date).split('-').map(Number);
      const [hh, mm] = String(schedule.time).split(':').map(Number);
      const when = new Date(y, (m || 1) - 1, d, hh, mm);
      const now = new Date();
      const oneMinuteAgo = now.getTime() - (1 * 60 * 1000); // 1 minute buffer
      
      // Mark as "Missed" if:
      // 1. Status is "Pending" or "Active" (not already Done/Missed)
      // 2. Current time is past scheduled time
      // 3. It's been more than 1 minute past (buffer to prevent premature marking)
      const isPendingOrActive = rawStatus === 'Pending' || rawStatus === 'Active' || !rawStatus;
      if (isPendingOrActive && when.getTime() < oneMinuteAgo) {
        return 'Missed';
      }
      
      return rawStatus || 'Pending';
    } catch {
      return rawStatus || 'Pending';
    }
  };

  return (
    <View style={{ flex: 1 }}>
    <ScrollView style={[styles.container, { backgroundColor: theme.background }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: theme.card }]}>
        <TouchableOpacity 
          style={styles.backButton} 
          onPress={() => {
            console.log('[MonitorManageScreen] Back button pressed');
            // Close alarm modal if open (non-blocking)
            if (alarmVisible) {
              setAlarmVisible(false);
            }
            // Navigate back immediately (don't wait for async operations)
            navigation.goBack();
          }}
        >
          <Ionicons name="arrow-back" size={24} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: theme.secondary, flex: 1 }]}>
          MONITOR & MANAGE
        </Text>
        {schedules.length > 0 && (
          <TouchableOpacity 
            style={[styles.deleteAllButton, { backgroundColor: theme.error }]}
            onPress={deleteAllSchedules}
          >
            <Ionicons name="trash" size={20} color={theme.card} />
          </TouchableOpacity>
        )}
        <TouchableOpacity 
          style={[styles.refreshButton, { backgroundColor: theme.primary }]}
          onPress={handleRefresh}
        >
          <Ionicons name="refresh" size={20} color={theme.card} />
        </TouchableOpacity>
      </View>

        {/* Current Scheduled Section - Dropdown */}
      <View style={[styles.scheduleSection, { backgroundColor: theme.card }]}>
          <TouchableOpacity 
            style={styles.dropdownHeader}
            onPress={() => setSchedulesExpanded(!schedulesExpanded)}
            activeOpacity={0.7}
          >
            <View style={styles.dropdownHeaderContent}>
        <Text style={[styles.sectionTitle, { color: theme.secondary }]}>
          Current Schedules
        </Text>
              {schedules.length > 0 && (
                <View style={[styles.scheduleCountBadge, { backgroundColor: theme.primary }]}>
                  <Text style={[styles.scheduleCountText, { color: theme.card }]}>
                    {schedules.length}
                  </Text>
                </View>
              )}
            </View>
            <Ionicons 
              name={schedulesExpanded ? "chevron-up" : "chevron-down"} 
              size={24} 
              color={theme.secondary} 
            />
          </TouchableOpacity>
          
          {schedulesExpanded && (
            <>
        {schedules.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
              No pending schedules found
            </Text>
          </View>
        ) : (
          <View style={styles.schedulesList}>
            {schedules.map((schedule: any, index: number) => {
              // Find medication name from ID
              const medication = medications.find(med => med.medId === schedule.medication);
              const medicationName = medication ? medication.name : `ID: ${schedule.medication}`;
              
              return (
                <View key={schedule._id || index} style={[styles.scheduleItem, { borderColor: theme.border }]}>
                  <View style={styles.scheduleHeader}>
                    <Text style={[styles.scheduleTitle, { color: theme.primary }]}>
                      Container {schedule.container}
                    </Text>
                    <View style={[
                      styles.statusBadge, 
                      { backgroundColor: deriveStatus(schedule) === 'Pending' ? theme.warning : deriveStatus(schedule) === 'Missed' ? theme.error : theme.success }
                    ]}>
                      <Text style={[styles.statusText, { color: theme.card }]}>
                        {deriveStatus(schedule)}
                      </Text>
                    </View>
                  </View>
                  
                  <View style={styles.scheduleDetails}>
                    <Text style={[styles.detailText, { color: theme.text }]}>
                      <Text style={styles.label}>Medication:</Text> {medicationName || 'Unknown Medication'}
                    </Text>
                    <Text style={[styles.detailText, { color: theme.text }]}>
                      <Text style={styles.label}>Date:</Text> {schedule.date}
                    </Text>
                    <Text style={[styles.detailText, { color: theme.text }]}>
                      <Text style={styles.label}>Time:</Text> {schedule.time}
                    </Text>
                          {verifications[parseInt(schedule.container)] && (
                            <View style={styles.verificationBadge}>
                              <Ionicons 
                                name={verifications[parseInt(schedule.container)].result?.pass_ ? "checkmark-circle" : "alert-circle"} 
                                size={16} 
                                color={verifications[parseInt(schedule.container)].result?.pass_ ? "#4CAF50" : "#F44336"} 
                              />
                              <Text style={[
                                styles.verificationDetailText, 
                                { color: verifications[parseInt(schedule.container)].result?.pass_ ? "#4CAF50" : "#F44336" }
                              ]}>
                                {verifications[parseInt(schedule.container)].result?.pass_ 
                                  ? `Verified: ${verifications[parseInt(schedule.container)].result?.count || 0} pills (${Math.round((verifications[parseInt(schedule.container)].result?.confidence || 0) * 100)}%)`
                                  : 'Verification failed'}
                    </Text>
                            </View>
                          )}
                  </View>
                </View>
              );
            })}
          </View>
              )}
            </>
        )}
      </View>

      {/* Buttons Container */}
      <View style={styles.buttonsContainer}>
        <TouchableOpacity 
          style={[styles.button, { backgroundColor: theme.primary }]} 
            onPress={() => navigation.navigate("SetScreen" as never)}
          > 
            <Text style={[styles.buttonText, { color: theme.card }]}>SET MED SCHED</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.button, { backgroundColor: theme.secondary }]} 
            onPress={() => navigation.navigate("ModifyScheduleScreen" as never)}
          > 
            <Text style={[styles.buttonText, { color: theme.card }]}>MODIFY SCHED</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={[styles.button, { backgroundColor: theme.secondary }]} 
          onPress={() => navigation.navigate("Adherence" as never)}
        > 
          <Text style={[styles.buttonText, { color: theme.card }]}>VIEW ADHERENCE STATS & LOGS</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>

      {/* Alarm Modal */}
      <AlarmModal
        visible={alarmVisible}
        container={alarmContainer}
        time={alarmTime}
        onDismiss={() => setAlarmVisible(false)}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
  },
  header: {
    marginTop: 40,
    marginBottom: 20,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
    borderRadius: 15,
    elevation: 8,
  },
  backButton: {
    padding: 10,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginLeft: 10,
  },
  refreshButton: {
    padding: 8,
    borderRadius: 20,
    marginLeft: 10,
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  deleteAllButton: {
    padding: 8,
    borderRadius: 20,
    marginLeft: 10,
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
  },
  errorContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  errorText: {
    textAlign: 'center',
    marginBottom: 15,
    fontSize: 16,
  },
  retryButton: {
    padding: 12,
    borderRadius: 8,
    minWidth: 100,
    alignItems: 'center',
  },
  retryButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  buttonsContainer: {
    justifyContent: 'flex-start',
    alignItems: 'center',
    marginBottom: 20,
  },
  button: {
    width: '90%',
    padding: 15,
    borderRadius: 12,
    marginVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  scheduleSection: {
    marginTop: 20,
    padding: 15,
    borderRadius: 15,
    elevation: 5,
  },
  dropdownHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 5,
  },
  dropdownHeaderContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginRight: 10,
  },
  scheduleCountBadge: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    paddingHorizontal: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scheduleCountText: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  schedulesList: {
    // No specific styles needed here, items will be styled individually
  },
  scheduleItem: {
    padding: 15,
    borderRadius: 12,
    marginBottom: 10,
    borderWidth: 1,
  },
  scheduleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 5,
  },
  scheduleTitle: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  statusBadge: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 15,
  },
  statusText: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  scheduleDetails: {
    marginTop: 5,
  },
  detailText: {
    fontSize: 15,
    marginBottom: 3,
  },
  label: {
    fontWeight: 'bold',
    marginRight: 5,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  emptyText: {
    fontSize: 16,
    textAlign: 'center',
  },
  verificationBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    padding: 6,
    borderRadius: 6,
    backgroundColor: 'rgba(76, 175, 80, 0.1)',
    gap: 6,
  },
  verificationDetailText: {
    fontSize: 12,
    fontWeight: '500',
  },
});

export default MonitorManageScreen;