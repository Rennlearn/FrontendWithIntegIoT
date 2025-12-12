import React, { useState, useEffect } from "react";
import { View, Text, Image, TouchableOpacity, Modal, FlatList, ScrollView, StyleSheet, Platform, ActivityIndicator, Alert } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import BluetoothService from '@/services/BluetoothService';
import { useTheme } from '@/context/ThemeContext';
import { lightTheme, darkTheme } from '@/styles/theme';
import AsyncStorage from "@react-native-async-storage/async-storage";
import { jwtDecode } from "jwt-decode";
import verificationService from '@/services/verificationService';

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
  const [saving, setSaving] = useState(false);
  const [isCaregiver, setIsCaregiver] = useState(false);
  const [monitoringElder, setMonitoringElder] = useState<{ id: string; name: string } | null>(null);

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
    // Check monitoring status for caregivers
    checkMonitoringStatus();
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
      // Check monitoring status when screen comes into focus
      checkMonitoringStatus();
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
    
    // Check if this pill is already assigned to another container
    const otherContainers = Object.entries(selectedPills)
      .filter(([slot, selectedPill]) => 
        slot !== currentPillSlot.toString() && selectedPill === pill
      );
    
    if (otherContainers.length > 0) {
      const containerNumbers = otherContainers.map(([slot]) => slot).join(', ');
      Alert.alert(
        'Pill Already Assigned',
        `This pill (${pill}) is already assigned to Container ${containerNumbers}. Each pill can only be assigned to one container.`,
        [{ text: 'OK' }]
      );
      return;
    }
    
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

  const onChangeTime = (event: any, selected?: Date) => {
    // Update only the time portion of selectedDate
    if (Platform.OS === 'android') {
      if (event?.type === 'set' && selected) {
        setSelectedDate(prev => {
          const updated = new Date(prev);
          updated.setHours(selected.getHours());
          updated.setMinutes(selected.getMinutes());
          updated.setSeconds(0);
          updated.setMilliseconds(0);
          return updated;
        });
      }
      // Close picker whether set or dismissed
      setShowTimePicker(false);
    } else if (selected) {
      setSelectedDate(prev => {
        const updated = new Date(prev);
        updated.setHours(selected.getHours());
        updated.setMinutes(selected.getMinutes());
        updated.setSeconds(0);
        updated.setMilliseconds(0);
        return updated;
      });
    }
  };

  const onChangeDateOnly = (event: any, selected?: Date) => {
    // Update only the date portion of selectedDate
    if (Platform.OS === 'android') {
      if (event?.type === 'set' && selected) {
        setSelectedDate(prev => {
          const updated = new Date(prev);
          updated.setFullYear(selected.getFullYear());
          updated.setMonth(selected.getMonth());
          updated.setDate(selected.getDate());
          updated.setSeconds(0);
          updated.setMilliseconds(0);
          return updated;
        });
      }
      setShowDatePicker(false);
    } else if (selected) {
      setSelectedDate(prev => {
        const updated = new Date(prev);
        updated.setFullYear(selected.getFullYear());
        updated.setMonth(selected.getMonth());
        updated.setDate(selected.getDate());
        updated.setSeconds(0);
        updated.setMilliseconds(0);
        return updated;
      });
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
    // Use the selected date and time, clamping seconds/ms
    const alarmTime = new Date(selectedDate);
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

  // Get user role from JWT token
  const getUserRole = async (): Promise<string | null> => {
    try {
      const token = await AsyncStorage.getItem('token');
      if (!token) return null;
      
      const decodedToken = jwtDecode<DecodedToken>(token.trim());
      return decodedToken.role || null;
    } catch (error) {
      console.error('Error getting user role from token:', error);
      return null;
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

  // Get current caregiver ID from JWT token
  const getCurrentCaregiverId = async (): Promise<string | null> => {
    try {
      const token = await AsyncStorage.getItem('token');
      if (!token) {
        return null;
      }
      const decodedToken = jwtDecode<DecodedToken>(token.trim());
      const caregiverId = decodedToken.userId ?? decodedToken.id;
      return caregiverId || null;
    } catch (error) {
      console.error('[SetScreen] Error getting caregiver ID:', error);
      return null;
    }
  };

  // Create caregiver-elder connection if it doesn't exist
  const createCaregiverConnection = async (elderId: string): Promise<boolean> => {
    try {
      console.log(`[SetScreen] 🔧 Creating connection for elder ID: ${elderId}`);
      
      const token = await AsyncStorage.getItem('token');
      if (!token) {
        console.log('[SetScreen] ⚠️ No token found');
        return false;
      }

      const caregiverId = await getCurrentCaregiverId();
      if (!caregiverId) {
        console.log('[SetScreen] ⚠️ Could not get caregiver ID');
        return false;
      }

      // Try the new endpoint first
      const response = await fetch('https://pillnow-database.onrender.com/api/caregivers/connect', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token.trim()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          caregiverId: parseInt(caregiverId) || caregiverId,
          elderId: parseInt(elderId) || elderId,
          relationship: 'family',
          permissions: {
            viewMedications: true,
            viewAdherence: true,
            receiveAlerts: true
          }
        })
      });

      if (response.ok) {
        const data = await response.json();
        console.log('[SetScreen] ✅ Connection created successfully:', data);
        return true;
      } else {
        const errorText = await response.text();
        console.error(`[SetScreen] Failed to create connection (${response.status}): ${errorText}`);
        return false;
      }
    } catch (error) {
      console.error('[SetScreen] Error creating connection:', error);
      return false;
    }
  };

  // Check monitoring status for caregivers
  const checkMonitoringStatus = async () => {
    try {
      const userRole = await getUserRole();
      const selectedElderId = await getSelectedElderId();
      
      // Strict check: Only role '3' or 3 is caregiver, role '2' or 2 is elder
      const roleStr = userRole ? String(userRole) : '';
      const isCaregiverUser = roleStr === '3';
      const isElderUser = roleStr === '2';
      
      // IMPORTANT: If selectedElderId exists, treat user as caregiver (backend will detect them as caregiver anyway)
      const isActingAsCaregiver = isCaregiverUser || (selectedElderId !== null && selectedElderId !== undefined);
      
      // Only show as caregiver if user is actually a caregiver (not elder) OR has selected elder
      const shouldShowAsCaregiver = isActingAsCaregiver && !isElderUser;
      
      // If user is ONLY an elder (not a caregiver), clear any selectedElderId
      if (isElderUser && !isCaregiverUser) {
        await AsyncStorage.removeItem('selectedElderId');
        await AsyncStorage.removeItem('selectedElderName');
        console.log('[SetScreen] Cleared selectedElderId for elder-only user');
      }
      
      console.log('[SetScreen] User role:', userRole, 'Is caregiver:', isCaregiverUser, 'Is elder:', isElderUser, 'Has selected elder:', selectedElderId !== null, 'Should show as caregiver:', shouldShowAsCaregiver);
      setIsCaregiver(shouldShowAsCaregiver);
      
      // Only set monitoring elder if user is acting as a caregiver
      if (shouldShowAsCaregiver && selectedElderId) {
        const elderName = await AsyncStorage.getItem('selectedElderName');
        console.log('[SetScreen] Selected elder ID:', selectedElderId, 'Elder name:', elderName);
        if (elderName) {
          setMonitoringElder({ id: selectedElderId, name: elderName });
          console.log('[SetScreen] ✅ Monitoring status set:', { id: selectedElderId, name: elderName });
        } else {
          setMonitoringElder(null);
          console.log('[SetScreen] ⚠️ No elder selected or name missing');
        }
      } else {
        setMonitoringElder(null);
        if (!shouldShowAsCaregiver) {
          console.log('[SetScreen] User is not a caregiver and no elder selected');
        }
      }
    } catch (error) {
      console.error('[SetScreen] Error checking monitoring status:', error);
    }
  };

  // Save schedule data to database
  const saveScheduleData = async () => {
    try {
      setSaving(true);
      
      // Get selectedElderId once at the start
      const selectedElderId = await getSelectedElderId();
      const currentUserId = await getCurrentUserId();
      const userRole = await getUserRole();
      const isCaregiverByRole = (userRole === '3' || userRole === 3 || String(userRole) === '3') && 
                          !(userRole === '2' || userRole === 2 || String(userRole) === '2');
      
      // IMPORTANT: If selectedElderId exists, treat user as caregiver (backend will detect them as caregiver anyway)
      const isActingAsCaregiver = isCaregiverByRole || (selectedElderId !== null && selectedElderId !== undefined && String(selectedElderId) !== String(currentUserId));
      
      if (isActingAsCaregiver) {
        // Check if elder is selected
        if (!selectedElderId) {
          Alert.alert(
            'Elder Not Selected',
            'As a caregiver, you must select an elder to monitor before setting up a schedule. Please go to the dashboard and select an elder first.',
            [{ text: 'OK' }]
          );
          setSaving(false);
          return;
        }
        
        // Check if caregiver has active connection to elder
        // Try to verify connection, but if it fails (404), try to create it or allow access anyway
        const token = await AsyncStorage.getItem('token');
        if (token) {
          try {
            const decodedToken = jwtDecode<{ userId?: string; id?: string }>(token.trim());
            const caregiverId = decodedToken.userId || decodedToken.id;
            
            if (caregiverId) {
              const headers: HeadersInit = {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token.trim()}`
              };
              
              const connectionCheck = await fetch(`https://pillnow-database.onrender.com/api/caregiver-connections?caregiver=${caregiverId}&elder=${selectedElderId}`, {
                headers
              });
              
              if (connectionCheck.ok) {
                const connData = await connectionCheck.json();
                const connections = Array.isArray(connData) ? connData : (connData.connections || connData.data || []);
                const activeConn = connections.find((c: any) => {
                  const connElderId = c.elder?.userId || c.elder?._id || c.elder?.id || c.elder;
                  return String(connElderId) === String(selectedElderId) && 
                         (c.status === 'active' || c.status === 'Active' || c.status === 'ACTIVE');
                });
                
                if (activeConn) {
                  console.log('[SetScreen] ✅ Caregiver-elder connection verified');
                } else {
                  console.log('[SetScreen] ⚠️ Connection exists but not active, attempting to create/activate...');
                  // Try to create connection
                  await createCaregiverConnection(selectedElderId);
                }
              } else if (connectionCheck.status === 404) {
                // Connection doesn't exist - try to create it
                console.log('[SetScreen] ⚠️ Connection not found (404), attempting to create...');
                const created = await createCaregiverConnection(selectedElderId);
                if (!created) {
                  console.log('[SetScreen] ⚠️ Could not create connection, but allowing access since elder is selected');
                  // Allow access anyway - connection will be created or verified later
                }
              } else {
                // Other error (401, 403, 500, etc.)
                console.warn(`[SetScreen] Connection check returned ${connectionCheck.status}, but allowing access since elder is selected`);
                // Allow access - connection issues will be handled by backend
              }
            }
          } catch (error) {
            console.warn('[SetScreen] Connection check failed, but allowing access since elder is selected:', error);
            // Allow access - connection check is not critical for schedule creation
          }
        }
        
        // Note: Bluetooth connection check removed - not required for schedule creation
        // Schedules can be created without Bluetooth, they just won't sync to Arduino until connected
      }
      
      // Validate: Check for duplicate pills across containers
      const pillToContainers: Record<string, number[]> = {};
      for (let containerNum = 1; containerNum <= 3; containerNum++) {
        const pillName = selectedPills[containerNum as PillSlot];
        if (pillName) {
          if (!pillToContainers[pillName]) {
            pillToContainers[pillName] = [];
          }
          pillToContainers[pillName].push(containerNum);
        }
      }
      
      // Check for duplicates
      const duplicates = Object.entries(pillToContainers)
        .filter(([_, containers]) => containers.length > 1);
      
      if (duplicates.length > 0) {
        const duplicateMessages = duplicates.map(([pill, containers]) => 
          `${pill} is assigned to Containers ${containers.join(', ')}`
        );
        Alert.alert(
          'Duplicate Pills Detected',
          `Each pill can only be assigned to one container.\n\n${duplicateMessages.join('\n')}\n\nPlease remove the duplicate assignments before saving.`,
          [{ text: 'OK' }]
        );
        return;
      }
      
      // Get current user ID or selected elder ID (for caregivers only)
      let scheduleUserId = currentUserId;
      
      // Use the isActingAsCaregiver check from above - if caregiver and has selectedElderId, use elder's ID
      if (isActingAsCaregiver && selectedElderId) {
        // Caregiver: use selected elder's ID
        const elderIdNum = parseInt(selectedElderId);
        if (!isNaN(elderIdNum)) {
          scheduleUserId = elderIdNum;
          console.log(`[SetScreen] Caregiver setting schedule for elder ID: ${scheduleUserId} (selectedElderId: ${selectedElderId})`);
        } else {
          console.log(`[SetScreen] ⚠️ Invalid selectedElderId: ${selectedElderId}, using own ID: ${scheduleUserId}`);
        }
      } else {
        // Elder: use their own user ID (already set above)
        console.log(`[SetScreen] Elder setting schedule for their own ID: ${scheduleUserId}`);
      }
      
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
                user: scheduleUserId, // Use schedule user ID (elder's ID if caregiver, own ID if elder)
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
      
      // Get token for API requests
      const token = await AsyncStorage.getItem('token');
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token.trim()}`;
      }
      
      // NOTE: We no longer delete old schedules when adding new ones
      // This allows users to have multiple schedules and add new ones without losing existing ones
      // Old schedules will only be deleted if they are explicitly marked as "Missed" or "Done" and are older than 5 minutes
      // (handled by MonitorManageScreen auto-deletion logic)
      
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

      // Schedule local notifications on the device for each upcoming alarm time
      // This ensures the app notifies at the same time as the IoT box alarm
      try {
        // @ts-expect-error - dynamic import used only at runtime
        const Notifications = await import('expo-notifications');
        if (Notifications.default && typeof Notifications.default.scheduleNotificationAsync === 'function') {
          for (const record of scheduleRecords) {
            try {
              const [y, m, d] = String(record.date).split('-').map(Number);
              const [hh, mm] = String(record.time).split(':').map(Number);
              const fireDate = new Date(y, (m || 1) - 1, d, hh, mm, 0, 0);

              // Skip times that are already in the past
              if (!Number.isFinite(fireDate.getTime()) || fireDate.getTime() <= Date.now()) {
                continue;
              }

              const med = medications.find(med => med.medId === record.medication);
              const medName = med ? med.name : 'your medication';

              await Notifications.default.scheduleNotificationAsync({
                content: {
                  title: 'Medication Reminder',
                  body: `Time to take ${medName} from Container ${record.container}`,
                  sound: true,
                  ...(Platform.OS === 'android' && { priority: 'high' as const }),
                  data: { 
                    container: record.container, 
                    medicationId: record.medication,
                    scheduleId: record.scheduleId 
                  },
                },
                trigger: fireDate,
              });
            } catch (notifErr) {
              console.warn('[SetScreen] Failed to schedule local notification:', notifErr);
            }
          }
        } else {
          console.warn('[SetScreen] expo-notifications not available, skipping local notification scheduling');
        }
      } catch (e) {
        console.warn('[SetScreen] Could not import expo-notifications, skipping local notification scheduling:', e);
      }

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
      // After saving:
      // - Caregiver (acting for an elder): go back to Monitor & Manage (monitoring dashboard)
      // - Elder (own schedule): go back to ElderDashboard
      Alert.alert('Success', `Schedule saved successfully!${summaryText}`, [
        { 
          text: 'OK', 
          onPress: () => {
            if (isActingAsCaregiver) {
              navigation.navigate("MonitorManageScreen" as never);
            } else {
              navigation.navigate("ElderDashboard" as never);
            }
          } 
        }
      ]);
    } catch (err) {
      console.error('Error saving schedule:', err);
      Alert.alert('Error', `Failed to save schedule: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setSaving(false);
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
        {isCaregiver && monitoringElder ? (
          <Text style={[styles.headerTitle, { color: theme.secondary }]}>
            ELDER <Text style={[styles.elderNameHighlight, { color: theme.primary }]}>{monitoringElder.name.toUpperCase()}</Text> SCHEDULE
          </Text>
        ) : (
          <Text style={[styles.headerTitle, { color: theme.secondary }]}>
            SET-UP <Text style={[styles.headerHighlight, { color: theme.primary }]}>SCHEDULE</Text>
          </Text>
        )}
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
        style={[styles.confirmButton, { backgroundColor: theme.primary, opacity: (saving || verifying) ? 0.6 : 1 }]} 
        onPress={saveScheduleData}
        disabled={saving || verifying}
      > 
        {(saving || verifying) ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator size="small" color={theme.card} style={{ marginRight: 10 }} />
            <Text style={[styles.confirmButtonText, { color: theme.card }]}>
              {saving ? 'SAVING...' : 'VERIFYING...'}
            </Text>
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
            <Text style={[styles.modalTitle, { color: theme.secondary }]}>Set Date & Time for Container {currentPillSlot}</Text>
            <Text style={[styles.modalSubtitle, { color: theme.textSecondary }]}>
              Choose the exact date and time (24-hour format)
            </Text>
            
            {Platform.OS === 'android' ? (
              <>
                <TouchableOpacity 
                  onPress={() => setShowDatePicker(true)}
                  style={[styles.timeButton, { backgroundColor: theme.background, borderColor: theme.primary }]}
                >
                  <Ionicons name="calendar-outline" size={24} color={theme.primary} />
                  <Text style={[styles.timeButtonText, { color: theme.text }]}>
                    {selectedDate.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                  </Text>
                </TouchableOpacity>
                {showDatePicker && (
                  <DateTimePicker 
                    value={selectedDate} 
                    mode="date" 
                    display="default" 
                    onChange={onChangeDateOnly}
                    minimumDate={new Date()}
                  />
                )}
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
                    onChange={onChangeTime}
                    is24Hour={true}
                  />
                )}
              </>
            ) : (
              <>
                <DateTimePicker 
                  value={selectedDate} 
                  mode="date" 
                  display="spinner" 
                  onChange={onChangeDateOnly}
                  style={{ width: '100%' }}
                  minimumDate={new Date()}
                />
                <DateTimePicker 
                  value={selectedDate} 
                  mode="time" 
                  display="spinner" 
                  onChange={onChangeTime}
                  style={{ width: '100%' }}
                  is24Hour={true}
                />
              </>
            )}
            
            <View style={styles.modalButtons}>
              <TouchableOpacity 
                onPress={() => {
                  setAlarmModalVisible(false);
                  setShowTimePicker(false);
                  setShowDatePicker(false);
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
    paddingBottom: 30,
    gap: 8,
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
  elderNameHighlight: {
    fontSize: 18,
    fontWeight: 'bold',
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
    marginVertical: 8,
    marginBottom: 12,
    width: '100%',
    elevation: 2,
    minHeight: 120,
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
    marginBottom: 10,
    marginTop: 4,
    gap: 6,
    maxHeight: 150,
  },
  scheduleItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    borderRadius: 6,
    gap: 8,
    marginBottom: 4,
    minHeight: 36,
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
    padding: 16,
    borderRadius: 12,
    marginTop: 20,
    marginBottom: 20,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
    minHeight: 50,
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
