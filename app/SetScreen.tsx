import React, { useState, useEffect } from "react";
import { View, Text, Image, TouchableOpacity, Modal, FlatList, ScrollView, StyleSheet, Platform, ActivityIndicator, Alert } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import BluetoothService from './services/BluetoothService';
import { useTheme } from './context/ThemeContext';
import { lightTheme, darkTheme } from './styles/theme';
import AsyncStorage from "@react-native-async-storage/async-storage";
import { jwtDecode } from "jwt-decode";
import verificationService from './services/verificationService';

// Interface for decoded JWT token
interface DecodedToken {
  id: string;
  userId?: string;
  role?: string;
}

// Explicit types for slots and state objects
type PillSlot = 1 | 2 | 3;

type SelectedPillsState = Record<PillSlot, string | null>;

type AlarmsState = Record<number, Date[]>;

// Type for medication data from API
interface Medication {
  _id: string;
  name: string;
  description: string;
  dosage: string;
  form: string;
  manufacturer: string;
  createdAt: string;
  updatedAt: string;
  medId: number;
  __v: number;
}

const SetScreen = () => {
  const navigation = useNavigation();
  const { isDarkMode } = useTheme();
  const theme = isDarkMode ? darkTheme : lightTheme;
  const [pillModalVisible, setPillModalVisible] = useState(false);
  const [alarmModalVisible, setAlarmModalVisible] = useState(false);
  const [confirmModalVisible, setConfirmModalVisible] = useState(false);
  const [warningModalVisible, setWarningModalVisible] = useState(false);
  const [selectedPills, setSelectedPills] = useState<SelectedPillsState>({ 1: null, 2: null, 3: null });
  const [alarms, setAlarms] = useState<AlarmsState>({ 1: [], 2: [], 3: [] });
  const [currentPillSlot, setCurrentPillSlot] = useState<PillSlot | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [showDatePicker, setShowDatePicker] = useState<boolean>(false);
  const [showTimePicker, setShowTimePicker] = useState<boolean>(false);
  
  // New state for API data
  const [medications, setMedications] = useState<Medication[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verificationStatus, setVerificationStatus] = useState<Record<number, { status: 'pending' | 'success' | 'failed' | null; message?: string }>>({
    1: { status: null },
    2: { status: null },
    3: { status: null },
  });
  const [pillCounts, setPillCounts] = useState<Record<number, number>>({ 1: 0, 2: 0, 3: 0 });
  const [pillCountsLocked, setPillCountsLocked] = useState<Record<number, boolean>>({ 1: false, 2: false, 3: false });
  const [addingPill, setAddingPill] = useState<Record<number, boolean>>({ 1: false, 2: false, 3: false });
  const [addingTime, setAddingTime] = useState(false);
  const [continuing, setContinuing] = useState(false);

  // Remove useEffect that resets pill modal/alarm modal etc on mount
  // Only keep fetchMedications and initial setup that doesn't cause a jump or open modals
  useEffect(() => {
    fetchMedications();
    setSelectedPills({ 1: null, 2: null, 3: null });
    setAlarms({ 1: [], 2: [], 3: [] });
    setCurrentPillSlot(null);
    setSelectedDate(new Date());
    setShowDatePicker(false);
    setShowTimePicker(false);
    setPillCounts({ 1: 0, 2: 0, 3: 0 });
    setPillCountsLocked({ 1: false, 2: false, 3: false });
    setAddingPill({ 1: false, 2: false, 3: false });
    setAddingTime(false);
    setContinuing(false);
    // do NOT open any modals
  }, []);

  // Clear data when screen comes into focus
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      // Clear any existing data to start fresh
      setSelectedPills({ 1: null, 2: null, 3: null });
      setAlarms({ 1: [], 2: [], 3: [] });
      setCurrentPillSlot(null);
      setSelectedDate(new Date());
      setShowDatePicker(false);
      setShowTimePicker(false);
      setPillModalVisible(false);
      setAlarmModalVisible(false);
      setConfirmModalVisible(false);
      setWarningModalVisible(false);
      setPillCounts({ 1: 0, 2: 0, 3: 0 });
      setPillCountsLocked({ 1: false, 2: false, 3: false });
      setAddingPill({ 1: false, 2: false, 3: false });
      setAddingTime(false);
      setContinuing(false);
    });

    return unsubscribe;
  }, [navigation]);

  const resetAllData = () => {
    setSelectedPills({ 1: null, 2: null, 3: null });
    setAlarms({ 1: [], 2: [], 3: [] });
    setCurrentPillSlot(null);
    setSelectedDate(new Date());
    setShowDatePicker(false);
    setShowTimePicker(false);
    setPillModalVisible(false);
    setAlarmModalVisible(false);
    setConfirmModalVisible(false);
    setWarningModalVisible(false);
    setPillCounts({ 1: 0, 2: 0, 3: 0 });
    setPillCountsLocked({ 1: false, 2: false, 3: false });
    setAddingPill({ 1: false, 2: false, 3: false });
    setAddingTime(false);
    setContinuing(false);
  };

  const fetchMedications = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch('https://pillnow-database.onrender.com/api/medications');
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      const medsArray = Array.isArray(data) ? data : (data?.data || []);
      setMedications(medsArray);
    } catch (err) {
      console.error('Error fetching medications:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch medications');
    } finally {
      setLoading(false);
    }
  };

  const handlePillSelection = (pill: string) => {
    if (currentPillSlot === null) return;
    setSelectedPills((prev) => ({ ...prev, [currentPillSlot]: pill }));
    setPillModalVisible(false);
    setAlarmModalVisible(true);
  };

  const handleAddPill = async (slot: PillSlot) => {
    // Check if we've reached max pill count for this container
    const maxCount = pillCounts[slot] || 0;
    const currentScheduleCount = alarms[slot].length;
    
    if (maxCount === 0) {
      Alert.alert('Set Pill Count First', 'Please set the maximum pill count before adding schedule times.');
      return;
    }
    
    if (currentScheduleCount >= maxCount) {
      Alert.alert('Maximum Reached', `You have reached the maximum pill count (${maxCount}) for Container ${slot}. Cannot add more schedule times.`);
      return;
    }
    
    setAddingPill(prev => ({ ...prev, [slot]: true }));
    // Small delay to show loading animation
    await new Promise(resolve => setTimeout(resolve, 300));
    setCurrentPillSlot(slot);
    setWarningModalVisible(true);
    setAddingPill(prev => ({ ...prev, [slot]: false }));
  };

  const handleContinue = async () => {
    setContinuing(true);
    // Small delay to show loading animation
    await new Promise(resolve => setTimeout(resolve, 300));
    setWarningModalVisible(false);
    setPillModalVisible(true);
    setContinuing(false);
  };

  const onChangeDate = (event: any, selected?: Date) => {
    if (Platform.OS === 'android') {
      if (event?.type === 'set' && selected) {
        // Time picked - update selectedDate and confirm with the selected time
        const today = new Date();
        const updated = new Date(today);
        updated.setHours(selected.getHours());
        updated.setMinutes(selected.getMinutes());
        updated.setSeconds(0);
        updated.setMilliseconds(0);
        setSelectedDate(updated);
        setShowTimePicker(false);
        // Confirm with the selected time directly (not from state)
        confirmAlarmWithTime(updated);
      } else if (event?.type === 'dismissed') {
        setShowTimePicker(false);
        setAlarmModalVisible(false);
      }
    } else {
      // iOS
      if (selected) {
        const today = new Date();
        const updated = new Date(today);
        updated.setHours(selected.getHours());
        updated.setMinutes(selected.getMinutes());
        updated.setSeconds(0);
        updated.setMilliseconds(0);
        setSelectedDate(updated);
      }
    }
  };

  const confirmAlarmWithTime = (alarmTime: Date) => {
    if (currentPillSlot === null) return;
    setAlarms((prev) => ({
      ...prev,
      [currentPillSlot]: [...prev[currentPillSlot], alarmTime],
    }));
    // Close modals immediately after confirming alarm
    setAlarmModalVisible(false);
    setShowTimePicker(false);
    setCurrentPillSlot(null);
  };

  const confirmAlarm = async () => {
    if (currentPillSlot === null) return;
    setAddingTime(true);
    // Use the selectedDate that was set
    const today = new Date();
    const alarmTime = new Date(today);
    alarmTime.setHours(selectedDate.getHours());
    alarmTime.setMinutes(selectedDate.getMinutes());
    alarmTime.setSeconds(0);
    alarmTime.setMilliseconds(0);
    
    // Small delay to show loading animation
    await new Promise(resolve => setTimeout(resolve, 300));
    confirmAlarmWithTime(alarmTime);
    setAddingTime(false);
  };

  // Get current user ID from JWT token
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

      return userId;
    } catch (error) {
      console.error('Error getting user ID from token:', error);
      return 1; // Default fallback
    }
  };

  // Save schedule data to database
  const saveScheduleData = async () => {
    try {
      // Get current user ID
      const currentUserId = await getCurrentUserId();
      
      // Create schedule records for each pill and alarm combination
      const scheduleRecords: Array<{
        scheduleId: number;
        user: number;
        medication: number;
        container: number;
        date: string;
        time: string;
        status: string;
        alertSent: boolean;
      }> = [];
      let scheduleId = 1;
      
      // Process each container
      for (let containerNum = 1; containerNum <= 3; containerNum++) {
        const pillName = selectedPills[containerNum as PillSlot];
        const containerAlarms = alarms[containerNum];
        
        if (pillName && containerAlarms.length > 0) {
          // Find the medication ID from the medications array
          const medication = medications.find(med => med.name === pillName);
          if (medication) {
            // Create a schedule record for each alarm time using medication ID
            containerAlarms.forEach(alarmDate => {
              const scheduleRecord = {
                scheduleId: scheduleId++,
                user: currentUserId, // Use current user ID from token
                medication: medication.medId, // Use medication ID (number) as required by backend
                container: containerNum, // Add container number
                date: alarmDate.getFullYear() + '-' + 
                      String(alarmDate.getMonth() + 1).padStart(2, '0') + '-' + 
                      String(alarmDate.getDate()).padStart(2, '0'), // YYYY-MM-DD format (local time)
                time: String(alarmDate.getHours()).padStart(2, '0') + ':' + 
                      String(alarmDate.getMinutes()).padStart(2, '0'), // HH:MM format (local time)
                status: 'Pending',
                alertSent: false
              };
              scheduleRecords.push(scheduleRecord);
            });
          }
        }
      }
      
      // First, delete ALL old schedules for containers 1, 2, 3 for this user
      // This ensures old schedules are removed even if a container has no new schedule
      const token = await AsyncStorage.getItem('token');
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token.trim()}`;
      }
      
      // Get containers that have new schedules
      const containersWithNewSchedules = new Set(scheduleRecords.map(r => r.container));
      
      // Also get containers that were previously configured but now have no schedules (cleared)
      const allContainersToCheck = new Set([1, 2, 3]);
      
      // Fetch existing schedules to delete old ones
      try {
        const existingSchedulesResponse = await fetch('https://pillnow-database.onrender.com/api/medication_schedules', {
          headers
        });
        if (existingSchedulesResponse.ok) {
          const existingData = await existingSchedulesResponse.json();
          const allExistingSchedules = existingData.data || [];
          
          // Find ALL old schedules for containers 1, 2, 3 for this user
          // This includes containers that are being cleared (no new schedules)
          const oldSchedulesToDelete = allExistingSchedules.filter((sched: any) => {
            const schedContainer = parseInt(sched.container);
            const schedUser = parseInt(sched.user);
            return allContainersToCheck.has(schedContainer) && schedUser === currentUserId;
          });
          
          // Delete old schedules
          if (oldSchedulesToDelete.length > 0) {
            console.log(`[SetScreen] Deleting ${oldSchedulesToDelete.length} old schedule(s) for all containers (1, 2, 3) for user ${currentUserId}`);
            
            // Delete in batches to avoid overwhelming the backend
            const batchSize = 10;
            let deletedCount = 0;
            for (let i = 0; i < oldSchedulesToDelete.length; i += batchSize) {
              const batch = oldSchedulesToDelete.slice(i, i + batchSize);
              const deletePromises = batch.map((sched: any) =>
                fetch(`https://pillnow-database.onrender.com/api/medication_schedules/${sched._id}`, {
                  method: 'DELETE',
                  headers
                }).then(response => {
                  if (response.ok) {
                    deletedCount++;
                    return { success: true, id: sched._id };
                  } else {
                    console.warn(`[SetScreen] Failed to delete old schedule ${sched._id}: HTTP ${response.status}`);
                    return { success: false, id: sched._id };
                  }
                }).catch(err => {
                  console.warn(`[SetScreen] Failed to delete old schedule ${sched._id}:`, err);
                  return { success: false, id: sched._id };
                })
              );
              await Promise.all(deletePromises);
              
              // Small delay between batches
              if (i + batchSize < oldSchedulesToDelete.length) {
                await new Promise(resolve => setTimeout(resolve, 200));
              }
            }
            console.log(`[SetScreen] ✅ Deleted ${deletedCount} out of ${oldSchedulesToDelete.length} old schedule(s)`);
          } else {
            console.log(`[SetScreen] No old schedules to delete`);
          }
        }
      } catch (deleteErr) {
        console.warn('[SetScreen] Error deleting old schedules (non-critical):', deleteErr);
        // Continue even if delete fails - we'll still save new schedules
      }
      
      // Now send each new schedule record
      const promises = scheduleRecords.map(record => 
        fetch('https://pillnow-database.onrender.com/api/medication_schedules', {
          method: 'POST',
          headers,
          body: JSON.stringify(record),
        })
      );
      
      const responses = await Promise.all(promises);
      
      // Check if all requests were successful
      const failedResponses = responses.filter(response => !response.ok);
      if (failedResponses.length > 0) {
        const errorText = await failedResponses[0].text();
        console.error('API Error Response:', errorText);
        throw new Error(`HTTP error! status: ${failedResponses[0].status} - ${errorText}`);
      }
      
      const results = await Promise.all(responses.map(response => response.json()));
      
      // Log summary of saved schedules
      console.log(`[SetScreen] ✅ Successfully saved ${scheduleRecords.length} schedule records to backend:`);
      scheduleRecords.forEach((record, index) => {
        console.log(`  [${index + 1}] Container ${record.container} - ${record.time} (Schedule ID: ${results[index]?.scheduleId || 'N/A'})`);
      });

      // Save pill counts to backend for each container
      for (let containerNum = 1; containerNum <= 3; containerNum++) {
        if (pillCountsLocked[containerNum] && pillCounts[containerNum] > 0) {
          try {
            const containerId = `container${containerNum}`;
            await fetch('http://10.56.196.91:5001/set-schedule', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                container_id: containerId,
                pill_config: { count: pillCounts[containerNum] },
                times: [],
              }),
            });
          } catch (err) {
            console.warn(`Failed to save pill count for container ${containerNum}:`, err);
          }
        }
      }

      // After saving to backend, also program the Arduino over Bluetooth (optional - doesn't block verification)
      try {
        const isBluetoothActive = await BluetoothService.isConnectionActive();
        if (isBluetoothActive) {
          // Build schedules with container info: { time: "HH:MM", container: number }
          const scheduleList: Array<{ time: string; container: number }> = [];
          for (let containerNum = 1; containerNum <= 3; containerNum++) {
            const containerAlarms = alarms[containerNum as PillSlot];
            containerAlarms.forEach(alarmDate => {
              const hhmm = String(alarmDate.getHours()).padStart(2, '0') + ':' + String(alarmDate.getMinutes()).padStart(2, '0');
              scheduleList.push({ time: hhmm, container: containerNum });
            });
          }

          if (scheduleList.length > 0) {
            // Clear existing schedules on device, then add each schedule with container info
            console.log(`[SetScreen] Syncing ${scheduleList.length} schedules to Arduino...`);
            await BluetoothService.sendCommand('SCHED CLEAR\n');
            await new Promise(resolve => setTimeout(resolve, 200)); // Small delay between commands
            
            // Group schedules by container for logging
            const schedulesByContainer: Record<number, number> = { 1: 0, 2: 0, 3: 0 };
            
            for (const sched of scheduleList) {
              await BluetoothService.sendCommand(`SCHED ADD ${sched.time} ${sched.container}\n`);
              schedulesByContainer[sched.container] = (schedulesByContainer[sched.container] || 0) + 1;
              console.log(`[SetScreen] Added schedule: ${sched.time} for Container ${sched.container}`);
              await new Promise(resolve => setTimeout(resolve, 200)); // Small delay between commands
            }
            
            // Log summary
            const summary = Object.entries(schedulesByContainer)
              .filter(([_, count]) => count > 0)
              .map(([container, count]) => `Container ${container}: ${count} alarm${count > 1 ? 's' : ''}`)
              .join(', ');
            console.log(`[SetScreen] ✅ Successfully synced schedules to Arduino: ${summary}`);
            
            // Show success message with schedule count
            const totalSchedules = scheduleList.length;
            Alert.alert(
              'Schedules Synced',
              `Successfully set ${totalSchedules} alarm${totalSchedules > 1 ? 's' : ''} on Arduino:\n${summary}`,
              [{ text: 'OK' }]
            );
          }
        } else {
          console.log('Bluetooth not connected - skipping Arduino sync (ESP32-CAM verification will still work)');
        }
      } catch (btErr) {
        // Bluetooth errors are non-critical - ESP32-CAM verification works independently
        console.warn('Bluetooth schedule sync failed (non-critical):', btErr);
      }

      // Camera verification disabled - skipping ESP32-CAM verification
      // TODO: Re-enable when camera hardware is available
      // Trigger ESP32-CAM verification for containers with pills
      // This works independently of Bluetooth - ESP32-CAMs connect via WiFi/MQTT
      /*
      const containersToVerify: number[] = [];
      for (let containerNum = 1; containerNum <= 3; containerNum++) {
        if (selectedPills[containerNum as PillSlot]) {
          containersToVerify.push(containerNum);
        }
      }

      if (containersToVerify.length > 0) {
        setVerifying(true);
        try {
          // Trigger captures for each container in parallel
          const verificationPromises = containersToVerify.map(async (containerNum) => {
            const containerId = verificationService.getContainerId(containerNum);
            
            // Use exact expected count from user input
            const pillCount = pillCounts[containerNum] || 0;
            
            setVerificationStatus(prev => ({
              ...prev,
              [containerNum]: { status: 'pending', message: 'Capturing image...' }
            }));

            // Trigger capture - handle gracefully if backend is unreachable
            const captureResult = await verificationService.triggerCapture(containerId, { count: pillCount });
            
            if (!captureResult.ok) {
              // Backend unreachable - show warning but don't block
              setVerificationStatus(prev => ({
                ...prev,
                [containerNum]: { 
                  status: 'warning', 
                  message: 'Backend unreachable - ESP32-CAM may still capture via MQTT' 
                }
              }));
              // Don't try to check result if capture failed
              return { containerNum, success: false, message: captureResult.message };
            }
            
            // Wait a bit for the capture to complete, then check result
            await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds for capture and verification
            
            const result = await verificationService.getVerificationResult(containerId);
            setVerificationStatus(prev => ({
              ...prev,
              [containerNum]: {
                status: result.success && result.result?.pass_ ? 'success' : 'failed',
                message: result.result?.pass_ 
                  ? `Verified: ${result.result.count} pills detected (${Math.round((result.result.confidence || 0) * 100)}% confidence)`
                  : result.message || 'Verification failed or backend unreachable'
              }
            }));

            // Return result for alert handling
            return { 
              containerNum, 
              success: result.success, 
              pass: result.result?.pass_,
              message: result.message 
            };
          });

          // Wait for all verifications to complete
          const results = await Promise.all(verificationPromises);
          
          setVerifying(false);
          
          // Check if any verification failed
          const failedVerifications = results.filter(r => r.success && !r.pass);
          
          if (failedVerifications.length > 0) {
            // Show alert for failed verifications
            const failedContainers = failedVerifications.map(r => `Container ${r.containerNum}`).join(', ');
            Alert.alert(
              'Verification Failed',
              `The pills in ${failedContainers} do not match the expected configuration. Please check and retry.`,
              [
                { text: 'OK', onPress: () => {
                  // Close modals first
                  setPillModalVisible(false);
                  setAlarmModalVisible(false);
                  setConfirmModalVisible(false);
                  setWarningModalVisible(false);
                  resetAllData();
                  // Navigate back with small delay
                  setTimeout(() => {
                    navigation.goBack();
                  }, 100);
                }}
              ]
            );
          } else {
            // All verifications passed or were skipped
            Alert.alert(
              'Success',
              'Schedule saved successfully! Pill verification completed.',
              [
                { text: 'OK', onPress: () => {
                  // Close modals first
                  setPillModalVisible(false);
                  setAlarmModalVisible(false);
                  setConfirmModalVisible(false);
                  setWarningModalVisible(false);
                  resetAllData();
                  // Navigate back with small delay
                  setTimeout(() => {
                    navigation.goBack();
                  }, 100);
                }}
              ]
            );
          }
        } catch (verifyErr) {
          console.error('Error triggering verification:', verifyErr);
          setVerifying(false);
          Alert.alert(
            'Schedule Saved',
            `Schedule saved successfully! ${verifyErr instanceof Error ? verifyErr.message : 'Verification may have failed.'}`,
            [
              { text: 'OK', onPress: () => {
                // Close modals first
                setPillModalVisible(false);
                setAlarmModalVisible(false);
                setConfirmModalVisible(false);
                setWarningModalVisible(false);
                resetAllData();
                // Navigate back with small delay
                setTimeout(() => {
                  navigation.goBack();
                }, 100);
              }}
            ]
          );
        }
      } else {
      Alert.alert('Success', 'Schedule saved successfully!', [
        { text: 'OK', onPress: () => {
          // Reset all data and go back to prevent modification
          resetAllData();
          navigation.navigate("MonitorManageScreen" as never);
        }}
      ]);
      }
      */
      
      // Build summary of alarms set per container
      const alarmsSummary: string[] = [];
      for (let containerNum = 1; containerNum <= 3; containerNum++) {
        const alarmCount = alarms[containerNum as PillSlot].length;
        if (alarmCount > 0) {
          alarmsSummary.push(`Container ${containerNum}: ${alarmCount} alarm${alarmCount > 1 ? 's' : ''}`);
        }
      }
      const summaryText = alarmsSummary.length > 0 
        ? `\n\nAlarms set:\n${alarmsSummary.join('\n')}`
        : '';
      
      // Show success message without verification
      Alert.alert('Success', `Schedule saved successfully!${summaryText}`, [
        { text: 'OK', onPress: () => navigation.navigate("ElderDashboard" as never) }
      ]);
    } catch (err) {
      console.error('Error saving schedule:', err);
      Alert.alert('Error', `Failed to save schedule: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  return (
    <ScrollView 
      style={[styles.container, { backgroundColor: theme.background }]}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <View style={[styles.header, { backgroundColor: theme.card }]}>
        <TouchableOpacity 
          style={styles.backButton} 
          onPress={() => {
            // Close any open modals first (non-blocking)
            setPillModalVisible(false);
            setAlarmModalVisible(false);
            setConfirmModalVisible(false);
            setWarningModalVisible(false);
            // Reset all data when going back to prevent modification
            resetAllData();
            // Navigate back immediately (don't wait for async operations)
            setTimeout(() => {
              navigation.goBack();
            }, 0);
          }}
        >
          <Ionicons name="arrow-back" size={24} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.secondary }]}>
          SET-UP <Text style={[styles.headerHighlight, { color: theme.primary }]}>SCHEDULE</Text>
        </Text>
      </View>

      {/* RTC Time Display */}
      <View style={[styles.rtcTimeContainer, { backgroundColor: theme.card }]}>
        <Ionicons name="time-outline" size={16} color={theme.primary} />
        <Text style={[styles.rtcTimeText, { color: theme.text }]}>
          Device Time: {new Date().toLocaleString()}
        </Text>
      </View>
      
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.primary} />
          <Text style={[styles.loadingText, { color: theme.text }]}>Loading...</Text>
        </View>
      ) : error ? (
        <View style={styles.errorContainer}>
          <Text style={[styles.errorText, { color: theme.text }]}>{error}</Text>
          <TouchableOpacity 
            style={[styles.retryButton, { backgroundColor: theme.primary, opacity: loading ? 0.7 : 1 }]}
            onPress={fetchMedications}
            disabled={loading}
          >
            {loading ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <ActivityIndicator size="small" color={theme.card} />
                <Text style={[styles.retryButtonText, { color: theme.card }]}>Loading...</Text>
              </View>
            ) : (
              <Text style={[styles.retryButtonText, { color: theme.card }]}>Retry</Text>
            )}
          </TouchableOpacity>
        </View>
      ) : (
        ([1, 2, 3] as const).map((num) => {
          const verifyStatus = verificationStatus[num];
          const hasSchedule = alarms[num].length > 0;
          return (
          <View key={num} style={[styles.pillContainer, { backgroundColor: theme.card }]}>
            {/* Container Header */}
            <View style={styles.containerHeader}>
              <View style={[styles.containerBadge, { backgroundColor: theme.primary }]}>
                <Text style={[styles.containerBadgeText, { color: theme.card }]}>Container {num}</Text>
              </View>
              <TouchableOpacity 
                onPress={() => handleAddPill(num)}
                style={[
                  styles.addButton, 
                  { 
                    backgroundColor: theme.background,
                    opacity: (!pillCountsLocked[num] || (alarms[num].length < (pillCounts[num] || 0))) && !addingPill[num] ? 1 : 0.5
                  }
                ]}
                disabled={(pillCountsLocked[num] && alarms[num].length >= (pillCounts[num] || 0)) || addingPill[num]}
              >
                {addingPill[num] ? (
                  <ActivityIndicator size="small" color={theme.primary} />
                ) : (
                  <Ionicons 
                    name="add-circle" 
                    size={22} 
                    color={pillCountsLocked[num] && alarms[num].length >= (pillCounts[num] || 0) ? theme.textSecondary : theme.primary} 
                  />
                )}
              </TouchableOpacity>
            </View>

            {/* Pill Name */}
            <Text style={[styles.pillName, { color: theme.text }]}>
              {selectedPills[num] || "Tap + to add medication"}
            </Text>

            {/* Schedule Times */}
            {hasSchedule ? (
              <View style={styles.scheduleList}>
                {alarms[num].map((alarm: Date, index: number) => {
                  const timeStr = alarm.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
                  return (
                    <View key={index} style={[styles.scheduleItem, { backgroundColor: theme.background }]}>
                      <Ionicons name="alarm" size={14} color={theme.primary} />
                      <Text style={[styles.scheduleTime, { color: theme.text }]}>{timeStr}</Text>
                      <TouchableOpacity 
                        onPress={() => {
                          const newAlarms = [...alarms[num]];
                          newAlarms.splice(index, 1);
                          setAlarms(prev => ({ ...prev, [num]: newAlarms }));
                        }}
                      >
                        <Ionicons name="close-circle" size={16} color={theme.error} />
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </View>
            ) : (
              <Text style={[styles.noScheduleText, { color: theme.textSecondary }]}>
                No schedule set
              </Text>
            )}

            {/* Pill Count */}
            <View style={[styles.pillCountContainer, { borderTopColor: isDarkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' }]}>
              <Text style={[styles.pillCountLabel, { color: theme.text }]}>Max Count:</Text>
              {pillCountsLocked[num] ? (
                <View style={styles.lockedCountContainer}>
                  <Text style={[styles.pillCountValue, { color: theme.primary }]}>
                    {pillCounts[num] || 0}
                  </Text>
                  <Ionicons name="lock-closed" size={14} color={theme.textSecondary} />
                </View>
              ) : (
                <View style={styles.pillCountControls}>
                  <TouchableOpacity
                    onPress={() => {
                      const newCount = Math.max(0, (pillCounts[num] || 0) - 1);
                      setPillCounts(prev => ({ ...prev, [num]: newCount }));
                    }}
                    style={[styles.countButton, { backgroundColor: theme.background }]}
                  >
                    <Text style={[styles.countButtonText, { color: theme.text }]}>−</Text>
                  </TouchableOpacity>
                  <Text style={[styles.pillCountValue, { color: theme.primary }]}>
                    {pillCounts[num] || 0}
                  </Text>
                  <TouchableOpacity
                    onPress={() => {
                      const newCount = (pillCounts[num] || 0) + 1;
                      setPillCounts(prev => ({ ...prev, [num]: newCount }));
                    }}
                    style={[styles.countButton, { backgroundColor: theme.background }]}
                  >
                    <Text style={[styles.countButtonText, { color: theme.text }]}>+</Text>
                  </TouchableOpacity>
                  {pillCounts[num] > 0 && (
                    <TouchableOpacity
                      onPress={() => {
                        setPillCountsLocked(prev => ({ ...prev, [num]: true }));
                        Alert.alert('Pill Count Locked', `Maximum pill count for Container ${num} is set to ${pillCounts[num]}. You can add up to ${pillCounts[num]} schedule times.`);
                      }}
                      style={[styles.lockButton, { backgroundColor: theme.primary }]}
                    >
                      <Ionicons name="lock-closed" size={14} color={theme.card} />
                      <Text style={[styles.lockButtonText, { color: theme.card }]}>Lock</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </View>
            {pillCountsLocked[num] && (
              <Text style={[styles.countInfoText, { color: theme.textSecondary }]}>
                {alarms[num].length} / {pillCounts[num]} schedule times added
              </Text>
            )}

            {/* Verification Status */}
            {verifyStatus?.status && (
              <View style={styles.verificationStatus}>
                {verifyStatus.status === 'pending' && (
                  <>
                    <ActivityIndicator size="small" color={theme.primary} />
                    <Text style={[styles.verificationText, { color: theme.primary }]}>
                      Verifying...
                    </Text>
                  </>
                )}
                {verifyStatus.status === 'success' && (
                  <>
                    <Ionicons name="checkmark-circle" size={14} color={theme.success} />
                    <Text style={[styles.verificationText, { color: theme.success }]}>
                      Verified
                    </Text>
                  </>
                )}
                {verifyStatus.status === 'failed' && (
                  <>
                    <Ionicons name="close-circle" size={14} color={theme.error} />
                    <Text style={[styles.verificationText, { color: theme.error }]}>
                      Failed
                    </Text>
                  </>
                )}
              </View>
            )}
          </View>
          );
        })
      )}
      <TouchableOpacity 
        style={[styles.confirmButton, { backgroundColor: theme.primary, opacity: verifying ? 0.6 : 1 }]} 
        onPress={saveScheduleData}
        disabled={verifying}
      > 
        {verifying ? (
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <ActivityIndicator size="small" color={theme.card} style={{ marginRight: 10 }} />
            <Text style={[styles.confirmButtonText, { color: theme.card }]}>VERIFYING...</Text>
          </View>
        ) : (
        <Text style={[styles.confirmButtonText, { color: theme.card }]}>CONFIRM</Text>
        )}
      </TouchableOpacity>

      {/* Warning Modal */}
      <Modal visible={warningModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.card }]}>
            <TouchableOpacity 
              style={styles.closeButtonTop} 
              onPress={() => setWarningModalVisible(false)}
            >
              <Ionicons name="close-circle" size={24} color={theme.text} />
            </TouchableOpacity>
            <Ionicons name="warning" size={50} color="#FFA500" style={styles.warningIcon} />
            <Text style={[styles.modalTitle, { color: theme.secondary }]}>Important Notice</Text>
            <Text style={[styles.warningText, { color: theme.text }]}>
              Please put your medicine first to the container before setting it up.
            </Text>
            <TouchableOpacity 
              onPress={handleContinue} 
              style={[styles.continueButton, { backgroundColor: theme.primary, opacity: continuing ? 0.7 : 1 }]}
              disabled={continuing}
            >
              {continuing ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <ActivityIndicator size="small" color={theme.card} />
                  <Text style={[styles.continueButtonText, { color: theme.card }]}>Loading...</Text>
                </View>
              ) : (
                <Text style={[styles.continueButtonText, { color: theme.card }]}>Continue</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Pill Selection Modal */}
      <Modal visible={pillModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.card }]}>
            <Text style={[styles.modalTitle, { color: theme.secondary }]}>Select a Medication</Text>

            <FlatList 
              data={medications} 
              keyExtractor={(item) => item._id} 
              style={{ maxHeight: 250, width: '100%' }}
              renderItem={({ item }) => (
                <TouchableOpacity 
                  onPress={() => handlePillSelection(item.name)} 
                  style={[styles.modalItem, { borderBottomColor: theme.background }]}
                >
                  <View style={styles.medicationItem}>
                    <Text style={[styles.medicationName, { color: theme.primary }]}>{item.name}</Text>
                    <Text style={[styles.medicationStrength, { color: theme.text }]}>
                      {item.dosage} {item.form}
                    </Text>
                    <Text style={[styles.medicationDescription, { color: theme.text }]} numberOfLines={2}>
                      {item.description}
                    </Text>
                  </View>
                </TouchableOpacity>
              )} 
            />
            <TouchableOpacity 
              onPress={() => setPillModalVisible(false)} 
              style={[styles.cancelButton, { backgroundColor: theme.secondary }]}
            >
              <Text style={[styles.cancelButtonText, { color: theme.card }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Simplified Time Selection Modal */}
      <Modal visible={alarmModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.card }]}>
            <Text style={[styles.modalTitle, { color: theme.secondary }]}>Set Time for Container {currentPillSlot}</Text>
            <Text style={[styles.modalSubtitle, { color: theme.textSecondary }]}>
              Select time (24-hour format)
            </Text>
            
            {Platform.OS === 'android' ? (
              <>
                <TouchableOpacity 
                  onPress={() => setShowTimePicker(true)}
                  style={[styles.timeButton, { backgroundColor: theme.background, borderColor: theme.primary }]}
                >
                  <Ionicons name="time-outline" size={24} color={theme.primary} />
                  <Text style={[styles.timeButtonText, { color: theme.text }]}>
                    {selectedDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}
                  </Text>
                </TouchableOpacity>
                {showTimePicker && (
                  <DateTimePicker 
                    value={selectedDate} 
                    mode="time" 
                    display="default" 
                    onChange={onChangeDate}
                    is24Hour={true}
                  />
                )}
              </>
            ) : (
              <DateTimePicker 
                value={selectedDate} 
                mode="time" 
                display="spinner" 
                onChange={onChangeDate}
                style={{ width: '100%' }}
                is24Hour={true}
              />
            )}
            
            <View style={styles.modalButtons}>
              <TouchableOpacity 
                onPress={() => {
                  setAlarmModalVisible(false);
                  setShowTimePicker(false);
                }}
                style={[styles.modalButton, { backgroundColor: theme.secondary }]}
                disabled={addingTime}
              >
                <Text style={[styles.modalButtonText, { color: theme.card }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                onPress={confirmAlarm} 
                style={[styles.modalButton, { backgroundColor: theme.primary, opacity: addingTime ? 0.7 : 1 }]}
                disabled={addingTime}
              >
                {addingTime ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <ActivityIndicator size="small" color={theme.card} />
                    <Text style={[styles.modalButtonText, { color: theme.card }]}>Adding...</Text>
                  </View>
                ) : (
                  <Text style={[styles.modalButtonText, { color: theme.card }]}>Add Time</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    padding: 12,
    paddingBottom: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    width: '100%',
    marginTop: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    elevation: 3,
    marginBottom: 10,
  },
  backButton: {
    padding: 6,
    marginRight: 4,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginLeft: 4,
  },
  headerHighlight: {
    color: '#4A90E2',
  },
  pillImage: {
    width: 150,
    height: 100,
    resizeMode: 'contain',
    marginVertical: 20,
    alignSelf: 'center',
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 15,
    textAlign: 'center',
  },
  pillContainer: {
    borderRadius: 12,
    padding: 12,
    marginVertical: 6,
    width: '100%',
    elevation: 2,
  },
  rtcTimeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 10,
    marginBottom: 10,
    gap: 6,
  },
  rtcTimeText: {
    fontSize: 12,
    fontWeight: '500',
    flex: 1,
  },
  containerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  containerBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  containerBadgeText: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  addButton: {
    padding: 4,
    borderRadius: 20,
  },
  pillName: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
    minHeight: 20,
  },
  scheduleList: {
    marginBottom: 8,
    gap: 4,
  },
  scheduleItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 6,
    borderRadius: 6,
    gap: 6,
  },
  scheduleTime: {
    fontSize: 13,
    fontWeight: '500',
    flex: 1,
  },
  noScheduleText: {
    fontSize: 12,
    fontStyle: 'italic',
    marginBottom: 8,
  },
  pillCountContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
  },
  pillCountLabel: {
    fontSize: 12,
    fontWeight: '500',
  },
  pillCountControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  countButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  countButtonText: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  pillCountValue: {
    fontSize: 16,
    fontWeight: 'bold',
    minWidth: 24,
    textAlign: 'center',
  },
  pillText: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  alarmText: {
    fontSize: 14,
    marginTop: 4,
  },
  confirmButton: {
    padding: 14,
    borderRadius: 12,
    marginTop: 12,
    width: '100%',
    alignItems: 'center',
    elevation: 3,
  },
  confirmButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  modalContent: {
    width: '90%',
    maxWidth: 350,
    maxHeight: '80%',
    padding: 16,
    borderRadius: 15,
    alignItems: 'center',
    elevation: 5,
    position: 'relative',
  },
  closeButtonTop: {
    position: 'absolute',
    top: 10,
    right: 10,
    padding: 5,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 6,
    textAlign: 'center',
    marginTop: 8,
  },
  modalSubtitle: {
    fontSize: 13,
    marginBottom: 16,
    textAlign: 'center',
  },
  timeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    borderRadius: 10,
    borderWidth: 2,
    marginBottom: 16,
    gap: 8,
  },
  timeButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
  },
  modalButton: {
    flex: 1,
    padding: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  modalButtonText: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  modalItem: {
    padding: 12,
    borderBottomWidth: 1,
    width: '100%',
  },
  modalItemText: {
    fontSize: 16,
  },
  cancelButton: {
    marginTop: 12,
    padding: 12,
    borderRadius: 10,
    width: '100%',
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  datePickerText: {
    fontSize: 16,
    marginBottom: 15,
  },
  warningIcon: {
    marginBottom: 12,
    marginTop: 8,
  },
  warningText: {
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 20,
  },
  continueButton: {
    padding: 12,
    borderRadius: 10,
    width: '100%',
    alignItems: 'center',
    elevation: 3,
  },
  continueButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  errorText: {
    textAlign: 'center',
    marginTop: 20,
    fontSize: 16,
  },
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
    padding: 20,
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
  },
  errorContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
    padding: 20,
  },
  retryButton: {
    marginTop: 15,
    padding: 12,
    borderRadius: 8,
    minWidth: 100,
    alignItems: 'center',
  },
  retryButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  medicationItem: {
    paddingVertical: 6,
  },
  medicationName: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 3,
  },
  medicationStrength: {
    fontSize: 13,
    marginBottom: 3,
    opacity: 0.8,
  },
  medicationDescription: {
    fontSize: 11,
    opacity: 0.7,
    lineHeight: 14,
  },
  debugText: {
    fontSize: 14,
    marginBottom: 10,
    textAlign: 'center',
  },
  debugButton: {
    padding: 10,
    borderRadius: 8,
    marginVertical: 10,
    alignItems: 'center',
    elevation: 2,
  },
  debugButtonText: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  verificationStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 6,
  },
  verificationText: {
    fontSize: 12,
    marginLeft: 4,
  },
  lockedCountContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  lockButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    gap: 4,
    marginLeft: 6,
  },
  lockButtonText: {
    fontSize: 11,
    fontWeight: 'bold',
  },
  countInfoText: {
    fontSize: 11,
    marginTop: 4,
    fontStyle: 'italic',
  },
});

export default SetScreen;
