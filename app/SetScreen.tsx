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

  const handleAddPill = (slot: PillSlot) => {
    setCurrentPillSlot(slot);
    setWarningModalVisible(true);
  };

  const handleContinue = () => {
    setWarningModalVisible(false);
    setPillModalVisible(true);
  };

  const onChangeDate = (event: any, selected?: Date) => {
    if (Platform.OS === 'android') {
      if (event?.type === 'set' && selected) {
        if (showTimePicker) {
          // Time picked
          const updated = new Date(selectedDate);
          updated.setHours(selected.getHours());
          updated.setMinutes(selected.getMinutes());
          updated.setSeconds(0);
          updated.setMilliseconds(0);
          setSelectedDate(updated);
          setShowTimePicker(false);
          setConfirmModalVisible(true);
        } else {
          // Date picked
          const updated = new Date(selectedDate);
          updated.setFullYear(selected.getFullYear(), selected.getMonth(), selected.getDate());
          setSelectedDate(updated);
          setShowDatePicker(false);
          setShowTimePicker(true);
        }
      } else {
        // Dismissed
        setShowDatePicker(false);
        setShowTimePicker(false);
      }
    } else {
      // iOS: combined datetime
      if (selected) {
        setSelectedDate(selected);
      }
      setShowDatePicker(false);
    }
  };

  const confirmAlarm = () => {
    if (currentPillSlot === null) return;
    setAlarms((prev) => ({
      ...prev,
      [currentPillSlot]: [...prev[currentPillSlot], selectedDate],
    }));
    setConfirmModalVisible(false);
    setAlarmModalVisible(false);
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
      
      // Send each schedule record individually
      const token = await AsyncStorage.getItem('token');
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token.trim()}`;
      }
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

      // After saving to backend, also program the Arduino over Bluetooth (optional - doesn't block verification)
      try {
        const isBluetoothActive = await BluetoothService.isConnectionActive();
        if (isBluetoothActive) {
          // Build unique list of HH:MM times from state
          const times: string[] = [];
          for (let containerNum = 1; containerNum <= 3; containerNum++) {
            const containerAlarms = alarms[containerNum as PillSlot];
            containerAlarms.forEach(alarmDate => {
              const hhmm = String(alarmDate.getHours()).padStart(2, '0') + ':' + String(alarmDate.getMinutes()).padStart(2, '0');
              if (!times.includes(hhmm)) times.push(hhmm);
            });
          }

          if (times.length > 0) {
            // Clear existing schedules on device, then add each time
            await BluetoothService.sendCommand('SCHED CLEAR\n');
            for (const t of times) {
              await BluetoothService.sendCommand(`SCHED ADD ${t}\n`);
            }
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
          // Trigger captures for each container
          containersToVerify.forEach(async (containerNum) => {
            const containerId = verificationService.getContainerId(containerNum);
            
            // Use exact expected count from user input
            const pillCount = pillCounts[containerNum] || 0;
            
            setVerificationStatus(prev => ({
              ...prev,
              [containerNum]: { status: 'pending', message: 'Capturing image...' }
            }));

            try {
              await verificationService.triggerCapture(containerId, { count: pillCount });
              
              // Wait a bit for the capture to complete, then check result
              setTimeout(async () => {
                try {
                  const result = await verificationService.getVerificationResult(containerId);
                  setVerificationStatus(prev => ({
                    ...prev,
                    [containerNum]: {
                      status: result.success && result.result?.pass_ ? 'success' : 'failed',
                      message: result.result?.pass_ 
                        ? `Verified: ${result.result.count} pills detected (${Math.round((result.result.confidence || 0) * 100)}% confidence)`
                        : result.message || 'Verification failed'
                    }
                  }));

                  // Show alert if verification failed
                  if (!result.success || !result.result?.pass_) {
                    Alert.alert(
                      `Container ${containerNum} Verification Failed`,
                      result.message || 'The pills in this container do not match the expected configuration. Please check and retry.',
                      [{ text: 'OK' }]
                    );
                  }
                } catch (checkErr) {
                  console.error(`Error checking verification result for container ${containerNum}:`, checkErr);
                  setVerificationStatus(prev => ({
                    ...prev,
                    [containerNum]: { status: 'failed', message: 'Could not check verification result' }
                  }));
                }
              }, 5000); // Wait 5 seconds for capture and verification
            } catch (verifyErr) {
              console.error(`Error triggering verification for container ${containerNum}:`, verifyErr);
              setVerificationStatus(prev => ({
                ...prev,
                [containerNum]: { 
                  status: 'failed', 
                  message: verifyErr instanceof Error ? verifyErr.message : 'Verification error occurred' 
                }
              }));
            }
          });

          // Don't wait for all verifications, show success message immediately
          setVerifying(false);
          
          Alert.alert(
            'Success',
            'Schedule saved successfully! Pill verification is in progress.',
            [
              { text: 'OK', onPress: () => navigation.navigate("ElderDashboard" as never) }
            ]
          );
        } catch (verifyErr) {
          console.error('Error triggering verification:', verifyErr);
          setVerifying(false);
          Alert.alert(
            'Schedule Saved',
            `Schedule saved successfully! ${verifyErr instanceof Error ? verifyErr.message : 'Verification may have failed.'}`,
            [
              { text: 'OK', onPress: () => navigation.navigate("ElderDashboard" as never) }
            ]
          );
        }
      } else {
        Alert.alert('Success', 'Schedule saved successfully!', [
          { text: 'OK', onPress: () => navigation.navigate("ElderDashboard" as never) }
        ]);
      }
      */
      
      // Show success message without verification
      Alert.alert('Success', 'Schedule saved successfully!', [
        { text: 'OK', onPress: () => navigation.navigate("ElderDashboard" as never) }
      ]);
    } catch (err) {
      console.error('Error saving schedule:', err);
      Alert.alert('Error', `Failed to save schedule: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  return (
    <ScrollView style={[styles.container, { backgroundColor: theme.background }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: theme.card }]}>
        <TouchableOpacity 
          style={styles.backButton} 
          onPress={() => navigation.navigate('ElderDashboard' as never)}
        >
          <Ionicons name="arrow-back" size={30} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.secondary }]}>
          SET-UP <Text style={[styles.headerHighlight, { color: theme.primary }]}>SCHEDULE</Text>
        </Text>
      </View>

      <Image source={require("@/assets/images/pillnow.png")} style={styles.pillImage} />
      
      <Text style={[styles.sectionTitle, { color: theme.secondary }]}>Pill Intake</Text>
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.primary} />
          <Text style={[styles.loadingText, { color: theme.text }]}>Loading medications...</Text>
        </View>
      ) : error ? (
        <View style={styles.errorContainer}>
          <Text style={[styles.errorText, { color: theme.text }]}>{error}</Text>
          <TouchableOpacity 
            style={[styles.retryButton, { backgroundColor: theme.primary }]}
            onPress={fetchMedications}
          >
            <Text style={[styles.retryButtonText, { color: theme.card }]}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        ([1, 2, 3] as const).map((num) => {
          const verifyStatus = verificationStatus[num];
          return (
            <View key={num} style={[styles.pillContainer, { backgroundColor: theme.card }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.pillText, { color: theme.primary }]}>Container {num}: {selectedPills[num] || "ADD PILL"}</Text>
                {alarms[num].map((alarm: Date, index: number) => (
                  <Text key={index} style={[styles.alarmText, { color: theme.text }]}>{alarm.toLocaleString()}</Text>
                ))}
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
                  <Text style={[styles.alarmText, { color: theme.text, marginRight: 10 }]}>Expected pills:</Text>
                  <TouchableOpacity
                    onPress={() => setPillCounts(prev => ({ ...prev, [num]: Math.max(0, (prev[num] || 0) - 1) }))}
                    style={{ paddingHorizontal: 10, paddingVertical: 4, backgroundColor: theme.background, borderRadius: 6, marginRight: 8 }}
                  >
                    <Text style={{ color: theme.text, fontSize: 16 }}>-</Text>
                  </TouchableOpacity>
                  <Text style={{ width: 28, textAlign: 'center', color: theme.text, fontWeight: 'bold' }}>{pillCounts[num] || 0}</Text>
                  <TouchableOpacity
                    onPress={() => setPillCounts(prev => ({ ...prev, [num]: (prev[num] || 0) + 1 }))}
                    style={{ paddingHorizontal: 10, paddingVertical: 4, backgroundColor: theme.background, borderRadius: 6, marginLeft: 8 }}
                  >
                    <Text style={{ color: theme.text, fontSize: 16 }}>+</Text>
                  </TouchableOpacity>
                </View>
                {verifyStatus?.status && (
                  <View style={styles.verificationStatus}>
                    {verifyStatus.status === 'pending' && (
                      <>
                        <ActivityIndicator size="small" color={theme.primary} />
                        <Text style={[styles.verificationText, { color: theme.primary }]}>
                          {verifyStatus.message || 'Verifying...'}
                        </Text>
                      </>
                    )}
                    {verifyStatus.status === 'success' && (
                      <>
                        <Ionicons name="checkmark-circle" size={16} color="#4CAF50" />
                        <Text style={[styles.verificationText, { color: '#4CAF50' }]}>
                          {verifyStatus.message || 'Verified'}
                        </Text>
                      </>
                    )}
                    {verifyStatus.status === 'failed' && (
                      <>
                        <Ionicons name="close-circle" size={16} color="#F44336" />
                        <Text style={[styles.verificationText, { color: '#F44336' }]}>
                          {verifyStatus.message || 'Verification failed'}
                        </Text>
                      </>
                    )}
                  </View>
                )}
              </View>
              <TouchableOpacity onPress={() => handleAddPill(num)}>
                <Ionicons name="add-circle-outline" size={24} color={theme.primary} />
              </TouchableOpacity>
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
              style={[styles.continueButton, { backgroundColor: theme.primary }]}
            >
              <Text style={[styles.continueButtonText, { color: theme.card }]}>Continue</Text>
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
              style={{ maxHeight: 300, width: '100%' }}
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

      {/* Alarm & Date Selection Modal */}
      <Modal visible={alarmModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.card }]}>
            <Text style={[styles.modalTitle, { color: theme.secondary }]}>Set Alarm</Text>
            <TouchableOpacity onPress={() => setShowDatePicker(true)}>
              <Text style={[styles.datePickerText, { color: theme.primary }]}>Pick Date & Time</Text>
            </TouchableOpacity>
            {showDatePicker && (
              <DateTimePicker 
                value={selectedDate} 
                mode={Platform.OS === 'ios' ? 'datetime' : 'date'} 
                display="default" 
                onChange={onChangeDate} 
              />
            )}
            {Platform.OS === 'android' && showTimePicker && (
              <DateTimePicker 
                value={selectedDate} 
                mode="time" 
                display="default" 
                onChange={onChangeDate} 
              />
            )}
            <TouchableOpacity 
              onPress={confirmAlarm} 
              style={[styles.confirmButton, { backgroundColor: theme.primary }]}
            >
              <Text style={[styles.confirmButtonText, { color: theme.card }]}>Confirm</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    width: '100%',
    marginTop: 40,
    padding: 15,
    borderRadius: 15,
    elevation: 8,
  },
  backButton: {
    padding: 10,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    marginLeft: 10,
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
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 15,
    padding: 15,
    marginVertical: 8,
    width: '100%',
    justifyContent: 'space-between',
    elevation: 3,
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
    padding: 15,
    borderRadius: 12,
    marginTop: 20,
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
    width: 350,
    maxHeight: 500,
    padding: 20,
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
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 15,
  },
  modalItem: {
    padding: 15,
    borderBottomWidth: 1,
    width: '100%',
  },
  modalItemText: {
    fontSize: 16,
  },
  cancelButton: {
    marginTop: 20,
    padding: 15,
    borderRadius: 12,
    width: '100%',
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  datePickerText: {
    fontSize: 16,
    marginBottom: 15,
  },
  warningIcon: {
    marginBottom: 15,
    marginTop: 10,
  },
  warningText: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 25,
    lineHeight: 24,
  },
  continueButton: {
    padding: 15,
    borderRadius: 12,
    width: '100%',
    alignItems: 'center',
    elevation: 3,
  },
  continueButtonText: {
    fontSize: 18,
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
    paddingVertical: 8,
  },
  medicationName: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  medicationStrength: {
    fontSize: 14,
    marginBottom: 4,
    opacity: 0.8,
  },
  medicationDescription: {
    fontSize: 12,
    opacity: 0.7,
    lineHeight: 16,
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
});

export default SetScreen;
