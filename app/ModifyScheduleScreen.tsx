import React, { useState, useEffect, useCallback } from "react";
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Platform, ActivityIndicator, Alert, FlatList, Modal } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import BluetoothService from '@/services/BluetoothService';
import { useTheme } from '@/context/ThemeContext';
import { lightTheme, darkTheme } from '@/styles/theme';
import AsyncStorage from "@react-native-async-storage/async-storage";
import { jwtDecode } from "jwt-decode";

// Interface for decoded JWT token
interface DecodedToken {
  id: string;
  userId?: string;
  role?: string;
}

// Interface for schedule data
interface Schedule {
  _id: string;
  scheduleId: number;
  user: number;
  medication: number;
  container: number;
  date: string;
  time: string;
  status: string;
  alertSent: boolean;
  medicationName?: string;
}

// Interface for medication data
interface Medication {
  _id: string;
  name: string;
  dosage: string;
  form: string;
  medId: number;
}

const ModifyScheduleScreen = () => {
  const navigation = useNavigation();
  const { isDarkMode } = useTheme();
  const theme = isDarkMode ? darkTheme : lightTheme;
  
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [medications, setMedications] = useState<Medication[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);
  const [editDateTime, setEditDateTime] = useState<Date>(new Date());
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [editPillCount, setEditPillCount] = useState<Record<number, number>>({ 1: 0, 2: 0, 3: 0 });
  const [pillCountsLocked, setPillCountsLocked] = useState<Record<number, boolean>>({ 1: false, 2: false, 3: false });
  const [saving, setSaving] = useState(false);
  const [deletingScheduleId, setDeletingScheduleId] = useState<string | null>(null);
  const [isCaregiver, setIsCaregiver] = useState(false);
  const [monitoringElder, setMonitoringElder] = useState<{ id: string; name: string } | null>(null);

  // Get current user ID from JWT token
  const getCurrentUserIdentifiers = async (): Promise<{ idNum: number; idStr: string }> => {
    try {
      const token = await AsyncStorage.getItem('token');
      if (!token) {
        console.warn('No token found, using default user ID 1');
        return { idNum: 1, idStr: '1' };
      }
      const decodedToken = jwtDecode<DecodedToken>(token.trim());
      const rawId = decodedToken.userId ?? decodedToken.id ?? '1';
      const userId = parseInt(rawId);
      const idNum = isNaN(userId) ? 1 : userId;
      const idStr = rawId?.toString?.() || '1';
      if (isNaN(userId)) {
        console.warn('Invalid user ID in token, using default user ID 1');
      }
      return { idNum, idStr };
    } catch (error) {
      console.error('Error getting user ID from token:', error);
      return { idNum: 1, idStr: '1' };
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

  // Check if caregiver has active connection to selected elder (ignore device requirement for testing)
  const checkCaregiverConnection = async (elderId: string): Promise<boolean> => {
    try {
      const token = await AsyncStorage.getItem('token');
      if (!token) {
        return false;
      }

      const headers: HeadersInit = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token.trim()}`
      };

      // Check caregiver-elder connection directly (ignore device)
      try {
        const decodedToken = jwtDecode<{ userId?: string; id?: string }>(token.trim());
        const caregiverId = decodedToken.userId || decodedToken.id;
        
        if (caregiverId) {
          const connectionCheck = await fetch(`https://pillnow-database.onrender.com/api/caregiver-connections?caregiver=${caregiverId}&elder=${elderId}`, {
            headers
          });
          
          if (connectionCheck.ok) {
            const connData = await connectionCheck.json();
            const connections = Array.isArray(connData) ? connData : (connData.connections || connData.data || []);
            const activeConn = connections.find((c: any) => {
              const connElderId = c.elder?.userId || c.elder?._id || c.elder?.id || c.elder;
              return String(connElderId) === String(elderId) && 
                     (c.status === 'active' || c.status === 'Active' || c.status === 'ACTIVE');
            });
            
            if (activeConn) {
              console.log('[ModifyScheduleScreen] ✅ Caregiver-elder connection verified (device check ignored)');
              return true;
            }
          }
        }
      } catch (connError) {
        console.error('[ModifyScheduleScreen] Error checking caregiver-elder connection:', connError);
      }

      // Fallback: Try the original endpoint (but ignore 404 for device)
      const response = await fetch(`https://pillnow-database.onrender.com/api/monitor/elder-device/${elderId}`, {
        headers
      });

      if (response.status === 401 || response.status === 403) {
        return false;
      }

      // Ignore 404 (device not connected) for testing
      if (response.status === 404) {
        console.log('[ModifyScheduleScreen] ⚠️ Device not connected (ignored for testing)');
        // Still return false, but we already checked caregiver-elder connection above
        return false;
      }

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.data) {
          const connection = data.data.connection || data.data;
          const isActive = connection?.status === 'active' || connection?.status === 'Active';
          const hasPermission = connection?.permissions?.viewAdherence !== false;
          return isActive && hasPermission;
        }
      }
      return false;
    } catch (error) {
      console.error('[ModifyScheduleScreen] Error checking caregiver connection:', error);
      return false;
    }
  };

  // Check monitoring status for caregivers
  const checkMonitoringStatus = async () => {
    try {
      const userRole = await getUserRole();
      const selectedElderId = await getSelectedElderId();
      const isCaregiverUser = userRole === '3' || userRole === '3' || String(userRole) === '3';
      
      // Fallback: If an elder is selected but role is null, assume they're a caregiver
      const hasSelectedElder = selectedElderId !== null;
      const shouldShowAsCaregiver = isCaregiverUser || (hasSelectedElder && userRole === null);
      
      setIsCaregiver(shouldShowAsCaregiver);
      
      if (shouldShowAsCaregiver && selectedElderId) {
        const elderName = await AsyncStorage.getItem('selectedElderName');
        if (elderName) {
          setMonitoringElder({ id: selectedElderId, name: elderName });
        } else {
          setMonitoringElder(null);
        }
      } else {
        setMonitoringElder(null);
      }
    } catch (error) {
      console.error('Error checking monitoring status:', error);
    }
  };

  const loadMedications = useCallback(async (): Promise<Medication[]> => {
    try {
      const response = await fetch('https://pillnow-database.onrender.com/api/medications', {
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
          'If-Modified-Since': '0'
        }
      });
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const data = await response.json();
      const medsArray = Array.isArray(data) ? data : (data?.data || []);
      setMedications(medsArray);
      return medsArray;
    } catch (err) {
      console.error('Error fetching medications:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch medications');
      return [];
    }
  }, []);

  const loadSchedules = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const { idNum: userId, idStr: userIdStr } = await getCurrentUserIdentifiers();
      
      // Get token for authentication
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
      
      // Fetch all schedules and filter by user ID (same approach as MonitorManageScreen)
      const response = await fetch('https://pillnow-database.onrender.com/api/medication_schedules', {
        headers
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const responseData = await response.json();
      const allSchedules = responseData.data || [];
      
      console.log(`[ModifyScheduleScreen] Fetched ${allSchedules.length} total schedule(s) from API`);
      
      // Check if there's a selected elder (for caregivers)
      const selectedElderId = await getSelectedElderId();
      
      // Filter schedules based on user role and selected elder (same as MonitorManageScreen)
      let userSchedules;
      if (selectedElderId) {
        // If caregiver has selected an elder, show that elder's schedules
        userSchedules = allSchedules.filter((schedule: any) => {
          const scheduleUserIdNum = parseInt(schedule.user);
          const scheduleUserIdStr = schedule.user?.toString?.() || '';
          return scheduleUserIdStr === selectedElderId || scheduleUserIdNum === parseInt(selectedElderId);
        });
        console.log(`[ModifyScheduleScreen] Filtered to ${userSchedules.length} schedule(s) for elder ${selectedElderId}`);
      } else {
        // Otherwise, show current user's schedules
        userSchedules = allSchedules.filter((schedule: any) => {
          const scheduleUserIdNum = parseInt(schedule.user);
          const scheduleUserIdStr = schedule.user?.toString?.() || '';
          return scheduleUserIdStr === userIdStr || scheduleUserIdNum === userId;
        });
        console.log(`[ModifyScheduleScreen] Filtered to ${userSchedules.length} schedule(s) for user ${userId}`);
      }
      
      // Always fetch fresh medications to ensure we have the latest data
      // This avoids race conditions with state updates
      const currentMedications = await loadMedications();
      
      // Enrich schedules with medication names and normalize container
      const enrichedSchedules = userSchedules.map((schedule: any) => {
        const medication = currentMedications.find(med => med.medId === schedule.medication);

        // Normalize container to a number (supports string like "container1" or "1")
        // Only allow valid containers: 1, 2, or 3
        const rawContainer = schedule.container;
        let parsedContainer =
          parseInt(rawContainer) ||
          parseInt(String(rawContainer).replace(/[^0-9]/g, '')) ||
          1;
        
        // Ensure container is only 1, 2, or 3
        if (parsedContainer < 1 || parsedContainer > 3) {
          console.warn(`[ModifyScheduleScreen] Invalid container value: ${rawContainer}, defaulting to 1`);
          parsedContainer = 1;
        }

        return {
          ...schedule,
          container: parsedContainer,
          medicationName: medication?.name || `Medication ID: ${schedule.medication}`
        } as Schedule;
      });
      
      // Filter to only show schedules that:
      // 1. Have valid containers (1, 2, or 3)
      // 2. Are not done (status !== 'Done')
      // 3. Haven't passed their scheduled time
      const now = new Date();
      const modifiableSchedules = enrichedSchedules.filter((schedule: Schedule) => {
        // First, ensure container is valid (1, 2, or 3)
        const containerNum = schedule.container;
        if (!containerNum || (containerNum !== 1 && containerNum !== 2 && containerNum !== 3)) {
          console.warn(`[ModifyScheduleScreen] Skipping schedule ${schedule._id} with invalid container: ${containerNum}`);
          return false; // Skip schedules with invalid containers
        }
        
        const statusLower = (schedule.status || 'Pending').toLowerCase();
        
        // Exclude done schedules
        if (statusLower === 'done') {
          return false;
        }
        
        // Check if schedule time has passed
        try {
          const scheduleDate = schedule.date; // Format: YYYY-MM-DD
          const scheduleTime = schedule.time; // Format: HH:MM
          
          if (!scheduleDate || !scheduleTime) {
            return false; // Invalid schedule data
          }
          
          // Parse schedule date and time
          const [year, month, day] = scheduleDate.split('-').map(Number);
          const [hours, minutes] = scheduleTime.split(':').map(Number);
          
          // Create schedule datetime
          const scheduleDateTime = new Date(year, month - 1, day, hours, minutes, 0, 0);
          
          // Check if schedule time has passed
          if (scheduleDateTime < now) {
            return false; // Schedule time has passed
          }
          
          return true; // Schedule is modifiable
        } catch (error) {
          console.warn(`[ModifyScheduleScreen] Error parsing schedule date/time for schedule ${schedule._id}:`, error);
          return false; // Skip invalid schedules
        }
      });
      
      console.log(`[ModifyScheduleScreen] ✅ Loaded ${enrichedSchedules.length} total schedule(s), ${modifiableSchedules.length} modifiable schedule(s) available (not done and not passed time)`);
      setSchedules(modifiableSchedules);
      
      // Load pill counts from schedules (get max count per container from schedule data)
      // Use modifiable schedules for pill count calculation
      const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0 };
      const locked: Record<number, boolean> = { 1: false, 2: false, 3: false };
      modifiableSchedules.forEach((schedule: Schedule) => {
        // If schedule has a count field, use it; otherwise default to number of schedules
        const containerNum = schedule.container;
        const scheduleCount = modifiableSchedules.filter((s: Schedule) => s.container === containerNum).length;
        if (!counts[containerNum] || counts[containerNum] < scheduleCount) {
          counts[containerNum] = scheduleCount;
        }
        // Lock pill count if there are any schedules (it's already been set)
        if (scheduleCount > 0) {
          locked[containerNum] = true;
        }
      });
      setEditPillCount(counts);
      setPillCountsLocked(locked);
    } catch (err) {
      console.error('Error loading schedules:', err);
      setError(err instanceof Error ? err.message : 'Failed to load schedules');
    } finally {
      setLoading(false);
    }
  }, [loadMedications]);

  useEffect(() => {
    const loadData = async () => {
      await loadMedications();
      await loadSchedules();
      await checkMonitoringStatus();
    };
    loadData();
  }, [loadSchedules, loadMedications]);

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', async () => {
      await loadMedications();
      await loadSchedules();
    });
    return unsubscribe;
  }, [navigation, loadSchedules, loadMedications]);

  const savePillCount = async (containerNum: number, count: number) => {
    try {
      // Save pill count to backend via /set-schedule endpoint
      const containerId = `container${containerNum}`;
      const response = await fetch('http://10.56.196.91:5001/set-schedule', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          container_id: containerId,
          pill_config: { count: count },
          times: [],
        }),
      });
      
      if (!response.ok) {
        console.warn('Failed to save pill count to backend');
      }
      
      // Also sync to Arduino if Bluetooth is connected
      try {
        const isBluetoothActive = await BluetoothService.isConnectionActive();
        if (isBluetoothActive) {
          // The pill count is used when triggering ESP32-CAM verification
          // Arduino doesn't need to know the count, it's just for verification
          console.log(`Pill count for container ${containerNum} updated to ${count}`);
        }
      } catch (btErr) {
        console.warn('Bluetooth sync failed for pill count:', btErr);
      }
    } catch (err) {
      console.error('Error saving pill count:', err);
    }
  };

  const openEditModal = (schedule: Schedule) => {
    // Check if schedule is modifiable (not done and not passed time)
    const statusLower = (schedule.status || 'Pending').toLowerCase();
    if (statusLower === 'done') {
      Alert.alert(
        'Cannot Edit',
        `This schedule cannot be edited because it is already marked as "Done". Only schedules that haven't been completed can be modified.`,
        [{ text: 'OK' }]
      );
      return;
    }
    
    // Check if schedule time has passed
    try {
      const now = new Date();
      const scheduleDate = schedule.date;
      const scheduleTime = schedule.time;
      
      if (scheduleDate && scheduleTime) {
        const [year, month, day] = scheduleDate.split('-').map(Number);
        const [hours, minutes] = scheduleTime.split(':').map(Number);
        const scheduleDateTime = new Date(year, month - 1, day, hours, minutes, 0, 0);
        
        if (scheduleDateTime < now) {
          Alert.alert(
            'Cannot Edit',
            `This schedule cannot be edited because its scheduled time has already passed. Only future schedules can be modified.`,
            [{ text: 'OK' }]
          );
          return;
        }
      }
    } catch (error) {
      console.warn('[ModifyScheduleScreen] Error checking schedule time:', error);
    }
    
    // Parse date (YYYY-MM-DD) and time (HH:MM) to Date
    const [hours, minutes] = schedule.time.split(':').map(Number);
    const [year, month, day] = schedule.date.split('-').map(Number);
    const editDate = new Date(year, (month || 1) - 1, day, hours, minutes, 0, 0);
    
    setEditingSchedule(schedule);
    setEditDateTime(editDate);
    setShowTimePicker(false);
    setShowDatePicker(false);
    setEditModalVisible(true);
  };

  const handleTimeChange = (event: any, selected?: Date) => {
    if (Platform.OS === 'android') {
      if (event?.type === 'set' && selected) {
        setEditDateTime(prev => {
          const updated = new Date(prev);
          updated.setHours(selected.getHours());
          updated.setMinutes(selected.getMinutes());
          updated.setSeconds(0);
          updated.setMilliseconds(0);
          return updated;
        });
      }
      setShowTimePicker(false);
    } else if (selected) {
      setEditDateTime(prev => {
        const updated = new Date(prev);
        updated.setHours(selected.getHours());
        updated.setMinutes(selected.getMinutes());
        updated.setSeconds(0);
        updated.setMilliseconds(0);
        return updated;
      });
    }
  };

  const handleDateChange = (event: any, selected?: Date) => {
    if (Platform.OS === 'android') {
      if (event?.type === 'set' && selected) {
        setEditDateTime(prev => {
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
      setEditDateTime(prev => {
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

  const saveEdit = async () => {
    if (!editingSchedule) return;
    
    // Double-check that schedule is still modifiable before saving
    const statusLower = (editingSchedule.status || 'Pending').toLowerCase();
    if (statusLower === 'done') {
      Alert.alert(
        'Cannot Save',
        `This schedule cannot be edited because it is marked as "Done". Only schedules that haven't been completed can be modified.`,
        [{ text: 'OK' }]
      );
      setEditModalVisible(false);
      await loadSchedules(); // Reload to get latest status
      return;
    }
    
    // Check if schedule time has passed
    try {
      const now = new Date();
      const scheduleDate = editingSchedule.date;
      const scheduleTime = editingSchedule.time;
      
      if (scheduleDate && scheduleTime) {
        const [year, month, day] = scheduleDate.split('-').map(Number);
        const [hours, minutes] = scheduleTime.split(':').map(Number);
        const scheduleDateTime = new Date(year, month - 1, day, hours, minutes, 0, 0);
        
        if (scheduleDateTime < now) {
          Alert.alert(
            'Cannot Save',
            `This schedule cannot be edited because its scheduled time has already passed. Only future schedules can be modified.`,
            [{ text: 'OK' }]
          );
          setEditModalVisible(false);
          await loadSchedules(); // Reload to get latest status
          return;
        }
      }
    } catch (error) {
      console.warn('[ModifyScheduleScreen] Error checking schedule time:', error);
    }
    
    // For caregivers only: Check if they have active connection to elder
    // Elders should NOT go through this validation - they can modify their own schedules
    const userRole = await getUserRole();
    const roleStr = userRole ? String(userRole) : '';
    const isCaregiverUser = roleStr === '3';
    if (isCaregiverUser) {
      const selectedElderId = await getSelectedElderId();
      if (selectedElderId) {
        const hasConnection = await checkCaregiverConnection(selectedElderId);
        if (!hasConnection) {
          Alert.alert(
            'No Active Connection',
            'You must have an active connection to this elder to modify schedules. Please check your caregiver-elder connection status.',
            [{ text: 'OK' }]
          );
          setEditModalVisible(false);
          return;
        }
      }
    }
    
    try {
      setSaving(true);
      
      // Get token for authentication
      const token = await AsyncStorage.getItem('token');
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token.trim()}`;
      }
      
      // Update date/time format
      const newTime = `${String(editDateTime.getHours()).padStart(2, '0')}:${String(editDateTime.getMinutes()).padStart(2, '0')}`;
      const newDate = `${editDateTime.getFullYear()}-${String(editDateTime.getMonth() + 1).padStart(2, '0')}-${String(editDateTime.getDate()).padStart(2, '0')}`;
      
      // Update schedule in backend
      // CRITICAL: Preserve the original container value - do NOT change it
      const originalContainer = editingSchedule.container;
      console.log(`[ModifyScheduleScreen] 🔍 Original container before update: ${originalContainer} (type: ${typeof originalContainer})`);
      
      // Include all original schedule fields to preserve the schedule completely
      // This ensures the backend doesn't reset any fields including container
      const updateData = {
        scheduleId: editingSchedule.scheduleId, // Preserve schedule ID
        user: editingSchedule.user, // Preserve user ID
        medication: editingSchedule.medication, // Preserve medication ID
        container: originalContainer, // CRITICAL: Use original container value, don't modify it
        time: newTime,
        date: newDate,
        status: editingSchedule.status, // Keep status as Pending
        alertSent: editingSchedule.alertSent
      };
      
      console.log(`[ModifyScheduleScreen] 📤 Sending update for schedule ${editingSchedule._id} with container: ${updateData.container}`);
      
      const response = await fetch(`https://pillnow-database.onrender.com/api/medication_schedules/${editingSchedule._id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(updateData),
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      // Immediately sync to Arduino via Bluetooth
      try {
        const isBluetoothActive = await BluetoothService.isConnectionActive();
        if (isBluetoothActive) {
          // Clear all schedules first
          await BluetoothService.sendCommand('SCHED CLEAR\n');
          await new Promise(resolve => setTimeout(resolve, 200));
          
          // Reload all schedules and rebuild Arduino schedule list
          const { idNum: userId } = await getCurrentUserIdentifiers();
          const allSchedulesResponse = await fetch(`https://pillnow-database.onrender.com/api/medication_schedules/user/${userId}`);
          if (allSchedulesResponse.ok) {
            const allSchedulesData = await allSchedulesResponse.json();
            const allSchedules = Array.isArray(allSchedulesData) ? allSchedulesData : (allSchedulesData?.data || []);
            
            // Build schedule list for Arduino
            const scheduleList: Array<{ time: string; container: number }> = [];
            allSchedules.forEach((sched: Schedule) => {
              const hhmm = sched.time;
              scheduleList.push({ time: hhmm, container: sched.container });
            });
            
            // Send all schedules to Arduino
            for (const sched of scheduleList) {
              await BluetoothService.sendCommand(`SCHED ADD ${sched.time} ${sched.container}\n`);
              await new Promise(resolve => setTimeout(resolve, 200));
            }
          }
        } else {
          console.log('Bluetooth not connected - skipping Arduino sync');
        }
      } catch (btErr) {
        console.warn('Bluetooth schedule sync failed:', btErr);
      }
      
      // Close modal and reload schedules
      setEditModalVisible(false);
      await loadSchedules();
      
      Alert.alert('Success', 'Schedule updated successfully!');
    } catch (err) {
      console.error('Error updating schedule:', err);
      Alert.alert('Error', `Failed to update schedule: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setSaving(false);
    }
  };

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

              // Delete all schedules in batches to avoid overwhelming the backend
              const batchSize = 10;
              let deletedCount = 0;
              
              for (let i = 0; i < schedules.length; i += batchSize) {
                const batch = schedules.slice(i, i + batchSize);
                const deletePromises = batch.map((schedule) =>
                  fetch(`https://pillnow-database.onrender.com/api/medication_schedules/${schedule._id}`, {
                    method: 'DELETE',
                    headers
                  }).then(response => {
                    if (response.ok) {
                      deletedCount++;
                      return response;
                    } else {
                      console.warn(`Failed to delete schedule ${schedule._id}: ${response.status}`);
                      return null;
                    }
                  }).catch(err => {
                    console.warn(`Failed to delete schedule ${schedule._id}:`, err);
                    return null;
                  })
                );

                await Promise.all(deletePromises);
                // Small delay between batches
                if (i + batchSize < schedules.length) {
                  await new Promise(resolve => setTimeout(resolve, 200));
                }
              }

              console.log(`[ModifyScheduleScreen] ✅ Deleted ${deletedCount} out of ${schedules.length} schedule(s)`);

              // Clear Arduino schedules
              try {
                const isBluetoothActive = await BluetoothService.isConnectionActive();
                if (isBluetoothActive) {
                  await BluetoothService.sendCommand('SCHED CLEAR\n');
                  console.log('[ModifyScheduleScreen] ✅ Cleared all schedules from Arduino');
                }
              } catch (btErr) {
                console.warn('Bluetooth schedule clear failed:', btErr);
              }

              // Reload schedules (will be empty now)
              await loadSchedules();
              
              Alert.alert('Success', `All ${schedules.length} schedule(s) deleted successfully!`);
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

  const deleteSchedule = async (scheduleId: string) => {
    if (deletingScheduleId) return; // Prevent double-clicks
    // Find the schedule to check if it's modifiable
    const schedule = schedules.find(s => s._id === scheduleId);
    if (schedule) {
      const statusLower = (schedule.status || 'Pending').toLowerCase();
      if (statusLower === 'done') {
        Alert.alert(
          'Cannot Delete',
          `This schedule cannot be deleted because it is marked as "Done". Only schedules that haven't been completed can be deleted.`,
          [{ text: 'OK' }]
        );
        return;
      }
      
      // Check if schedule time has passed
      try {
        const now = new Date();
        const scheduleDate = schedule.date;
        const scheduleTime = schedule.time;
        
        if (scheduleDate && scheduleTime) {
          const [year, month, day] = scheduleDate.split('-').map(Number);
          const [hours, minutes] = scheduleTime.split(':').map(Number);
          const scheduleDateTime = new Date(year, month - 1, day, hours, minutes, 0, 0);
          
          if (scheduleDateTime < now) {
            Alert.alert(
              'Cannot Delete',
              `This schedule cannot be deleted because its scheduled time has already passed. Only future schedules can be deleted.`,
              [{ text: 'OK' }]
            );
            return;
          }
        }
      } catch (error) {
        console.warn('[ModifyScheduleScreen] Error checking schedule time:', error);
      }
    }
    
    // For caregivers: Check if they have active connection to elder
    const userRole = await getUserRole();
    const isCaregiverUser = userRole === '3' || userRole === '3' || String(userRole) === '3';
    if (isCaregiverUser) {
      const selectedElderId = await getSelectedElderId();
      if (selectedElderId) {
        const hasConnection = await checkCaregiverConnection(selectedElderId);
        if (!hasConnection) {
          Alert.alert(
            'No Active Connection',
            'You must have an active connection to this elder to delete schedules. Please check your caregiver-elder connection status.',
            [{ text: 'OK' }]
          );
          return;
        }
      }
    }
    
    Alert.alert(
      'Delete Schedule',
      'Are you sure you want to delete this schedule?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              setDeletingScheduleId(scheduleId);
              const token = await AsyncStorage.getItem('token');
              const headers: HeadersInit = {
                'Content-Type': 'application/json',
              };
              if (token) {
                headers['Authorization'] = `Bearer ${token.trim()}`;
              }
              
              const response = await fetch(`https://pillnow-database.onrender.com/api/medication_schedules/${scheduleId}`, {
                method: 'DELETE',
                headers
              });
              
              if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
              }
              
              // Immediately sync to Arduino
              try {
                const isBluetoothActive = await BluetoothService.isConnectionActive();
                if (isBluetoothActive) {
                  await BluetoothService.sendCommand('SCHED CLEAR\n');
                  await new Promise(resolve => setTimeout(resolve, 200));
                  
                  // Reload and rebuild Arduino schedule list
                  const { idNum: userId } = await getCurrentUserIdentifiers();
                  const token = await AsyncStorage.getItem('token');
                  const headers: HeadersInit = {
                    'Content-Type': 'application/json',
                  };
                  if (token) {
                    headers['Authorization'] = `Bearer ${token.trim()}`;
                  }
                  
                  const allSchedulesResponse = await fetch('https://pillnow-database.onrender.com/api/medication_schedules', {
                    headers
                  });
                  if (allSchedulesResponse.ok) {
                    const allSchedulesData = await allSchedulesResponse.json();
                    const allSchedules = allSchedulesData.data || [];
                    const userSchedules = allSchedules.filter((s: any) => parseInt(s.user) === userId);
                    
                    const scheduleList: Array<{ time: string; container: number }> = [];
                    userSchedules.forEach((sched: Schedule) => {
                      const hhmm = sched.time;
                      scheduleList.push({ time: hhmm, container: sched.container });
                    });
                    
                    for (const sched of scheduleList) {
                      await BluetoothService.sendCommand(`SCHED ADD ${sched.time} ${sched.container}\n`);
                      await new Promise(resolve => setTimeout(resolve, 200));
                    }
                  }
                }
              } catch (btErr) {
                console.warn('Bluetooth schedule sync failed:', btErr);
              }
              
              await loadSchedules();
              Alert.alert('Success', 'Schedule deleted successfully!');
            } catch (err) {
              console.error('Error deleting schedule:', err);
              Alert.alert('Error', `Failed to delete schedule: ${err instanceof Error ? err.message : 'Unknown error'}`);
            } finally {
              setDeletingScheduleId(null);
            }
          }
        }
      ]
    );
  };

  // Group schedules by container (only containers 1, 2, 3)
  // Filter out any schedules with invalid containers
  const schedulesByContainer: Record<number, Schedule[]> = {
    1: schedules.filter(s => s.container === 1),
    2: schedules.filter(s => s.container === 2),
    3: schedules.filter(s => s.container === 3),
  };

  return (
    <ScrollView style={[styles.container, { backgroundColor: theme.background }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: theme.card }]}>
        <TouchableOpacity 
          style={styles.backButton} 
          onPress={() => navigation.goBack()}
        >
          <Ionicons name="arrow-back" size={30} color={theme.text} />
        </TouchableOpacity>
        {isCaregiver && monitoringElder ? (
          <Text style={[styles.headerTitle, { color: theme.secondary }]}>
            ELDER <Text style={[styles.elderNameHighlight, { color: theme.primary }]}>{monitoringElder.name.toUpperCase()}</Text> SCHEDULE
          </Text>
        ) : (
          <Text style={[styles.headerTitle, { color: theme.secondary }]}>
            MODIFY <Text style={[styles.headerHighlight, { color: theme.primary }]}>SCHEDULE</Text>
          </Text>
        )}
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.primary} />
          <Text style={[styles.loadingText, { color: theme.text }]}>Loading schedules...</Text>
        </View>
      ) : error ? (
        <View style={styles.errorContainer}>
          <Text style={[styles.errorText, { color: theme.text }]}>{error}</Text>
          <TouchableOpacity 
            style={[styles.retryButton, { backgroundColor: theme.primary }]}
            onPress={loadSchedules}
          >
            <Text style={[styles.retryButtonText, { color: theme.card }]}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : schedules.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="calendar-outline" size={64} color={theme.textSecondary} />
          <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
            No schedules found
          </Text>
          <Text style={[styles.emptySubtext, { color: theme.textSecondary }]}>
            Create a schedule in the Set Schedule screen
          </Text>
        </View>
      ) : (
        ([1, 2, 3] as const).map((containerNum) => {
          const containerSchedules = schedulesByContainer[containerNum];
          if (!containerSchedules || containerSchedules.length === 0) return null;
          
          // Get unique medication for this container
          const uniqueMedication = containerSchedules[0]?.medicationName || 'Unknown';
          
          return (
            <View key={containerNum} style={[styles.containerCard, { backgroundColor: theme.card }]}>
              <View style={styles.containerHeader}>
                <View style={[styles.containerBadge, { backgroundColor: theme.primary }]}>
                  <Text style={[styles.containerBadgeText, { color: theme.card }]}>
                    Container {containerNum}
                  </Text>
                </View>
                <Text style={[styles.medicationName, { color: theme.text }]}>
                  {uniqueMedication}
                </Text>
              </View>
              
              {/* Pill Count Display */}
              <View style={styles.pillCountContainer}>
                <Text style={[styles.pillCountLabel, { color: theme.text }]}>Max Pill Count:</Text>
                {pillCountsLocked[containerNum] ? (
                  <View style={styles.lockedCountContainer}>
                    <Text style={[styles.pillCountValue, { color: theme.primary }]}>
                      {editPillCount[containerNum] || 0} (Locked)
                    </Text>
                    <Ionicons name="lock-closed" size={16} color={theme.textSecondary} />
                  </View>
                ) : (
                  <View style={styles.pillCountControls}>
                    <TouchableOpacity
                      onPress={async () => {
                        const newCount = Math.max(0, (editPillCount[containerNum] || 0) - 1);
                        setEditPillCount(prev => ({ ...prev, [containerNum]: newCount }));
                        await savePillCount(containerNum, newCount);
                      }}
                      style={[styles.countButton, { backgroundColor: theme.background }]}
                    >
                      <Text style={[styles.countButtonText, { color: theme.text }]}>−</Text>
                    </TouchableOpacity>
                    <Text style={[styles.pillCountValue, { color: theme.primary }]}>
                      {editPillCount[containerNum] || 0}
                    </Text>
                    <TouchableOpacity
                      onPress={async () => {
                        const newCount = (editPillCount[containerNum] || 0) + 1;
                        setEditPillCount(prev => ({ ...prev, [containerNum]: newCount }));
                        await savePillCount(containerNum, newCount);
                      }}
                      style={[styles.countButton, { backgroundColor: theme.background }]}
                    >
                      <Text style={[styles.countButtonText, { color: theme.text }]}>+</Text>
                    </TouchableOpacity>
                    {editPillCount[containerNum] > 0 && (
                      <TouchableOpacity
                        onPress={() => {
                          setPillCountsLocked(prev => ({ ...prev, [containerNum]: true }));
                          Alert.alert('Pill Count Locked', `Maximum pill count for Container ${containerNum} is set to ${editPillCount[containerNum]}.`);
                        }}
                        style={[styles.lockButton, { backgroundColor: theme.primary }]}
                      >
                        <Ionicons name="lock-closed" size={16} color={theme.card} />
                        <Text style={[styles.lockButtonText, { color: theme.card }]}>Lock</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
                {pillCountsLocked[containerNum] && (
                  <Text style={[styles.countInfoText, { color: theme.textSecondary }]}>
                    {containerSchedules.length} / {editPillCount[containerNum]} schedule times
                  </Text>
                )}
              </View>
              
              {/* Schedule Times */}
              <View style={styles.scheduleList}>
                {containerSchedules.map((schedule) => {
                  const timeStr = schedule.time;
                  const dateStr = schedule.date;
                  const statusLower = (schedule.status || 'Pending').toLowerCase();
                  
                  // Check if schedule is modifiable (not done and not passed time)
                  let isModifiable = statusLower !== 'done';
                  if (isModifiable && schedule.date && schedule.time) {
                    try {
                      const now = new Date();
                      const [year, month, day] = schedule.date.split('-').map(Number);
                      const [hours, minutes] = schedule.time.split(':').map(Number);
                      const scheduleDateTime = new Date(year, month - 1, day, hours, minutes, 0, 0);
                      isModifiable = scheduleDateTime >= now;
                    } catch (error) {
                      isModifiable = false;
                    }
                  }
                  
                  const isEditable = isModifiable && !saving;
                  return (
                    <View key={schedule._id} style={[styles.scheduleItem, { backgroundColor: theme.background }]}>
                      <Ionicons name="alarm" size={16} color={theme.primary} />
                      <View style={{ flex: 1, marginLeft: 8 }}>
                        <Text style={[styles.scheduleTime, { color: theme.text }]}>{timeStr}</Text>
                        {dateStr && (
                          <Text style={[styles.scheduleDate, { color: theme.textSecondary }]}>
                            {dateStr}
                          </Text>
                        )}
                      </View>
                      <View style={[styles.statusBadge, { backgroundColor: isModifiable ? theme.success : theme.textSecondary }]}>
                        <Text style={[styles.statusText, { color: theme.card }]}>{schedule.status || 'Pending'}</Text>
                      </View>
                      <TouchableOpacity 
                        onPress={() => isEditable && openEditModal(schedule)}
                        style={[styles.editButton, { opacity: isEditable ? 1 : 0.4 }]}
                        disabled={!isEditable}
                      >
                        <Ionicons name="create-outline" size={18} color={theme.primary} />
                      </TouchableOpacity>
                      <TouchableOpacity 
                        onPress={() => isEditable && deleteSchedule(schedule._id)}
                        style={[
                          styles.deleteButton, 
                          { 
                            opacity: (isEditable && deletingScheduleId !== schedule._id) ? 1 : 0.4
                          }
                        ]}
                        disabled={!isEditable || deletingScheduleId !== null}
                      >
                        {deletingScheduleId === schedule._id ? (
                          <ActivityIndicator size="small" color={theme.error} />
                        ) : (
                          <Ionicons name="trash-outline" size={18} color={theme.error} />
                        )}
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </View>
            </View>
          );
        })
      )}

      {/* Edit Schedule Modal */}
      <Modal visible={editModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.card }]}>
            <TouchableOpacity 
              style={styles.closeButtonTop} 
              onPress={() => setEditModalVisible(false)}
            >
              <Ionicons name="close-circle" size={24} color={theme.text} />
            </TouchableOpacity>
            
            <Text style={[styles.modalTitle, { color: theme.secondary }]}>Edit Schedule</Text>
            
            {editingSchedule && (
              <>
                <Text style={[styles.editLabel, { color: theme.text }]}>
                  Container: {editingSchedule.container}
                </Text>
                <Text style={[styles.editLabel, { color: theme.text }]}>
                  Medication: {editingSchedule.medicationName || 'Unknown'}
                </Text>
                <Text style={[styles.editLabel, { color: theme.text }]}>Date:</Text>
                {Platform.OS === 'android' ? (
                  <>
                    <TouchableOpacity 
                      onPress={() => setShowDatePicker(true)}
                      style={[styles.timeButton, { backgroundColor: theme.background, borderColor: theme.primary }]}
                    >
                      <Ionicons name="calendar-outline" size={24} color={theme.primary} />
                      <Text style={[styles.timeButtonText, { color: theme.text }]}>
                        {editDateTime.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                      </Text>
                    </TouchableOpacity>
                    {showDatePicker && (
                      <DateTimePicker 
                        value={editDateTime} 
                        mode="date" 
                        display="default" 
                        onChange={handleDateChange}
                        minimumDate={new Date()}
                      />
                    )}
                  </>
                ) : (
                  <DateTimePicker 
                    value={editDateTime} 
                    mode="date" 
                    display="spinner" 
                    onChange={handleDateChange}
                    style={{ width: '100%' }}
                    minimumDate={new Date()}
                  />
                )}

                <Text style={[styles.editLabel, { color: theme.text }]}>Time:</Text>
                {Platform.OS === 'android' ? (
                  <>
                    <TouchableOpacity 
                      onPress={() => setShowTimePicker(true)}
                      style={[styles.timeButton, { backgroundColor: theme.background, borderColor: theme.primary }]}
                    >
                      <Ionicons name="time-outline" size={24} color={theme.primary} />
                      <Text style={[styles.timeButtonText, { color: theme.text }]}>
                        {editDateTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}
                      </Text>
                    </TouchableOpacity>
                    {showTimePicker && (
                      <DateTimePicker 
                        value={editDateTime} 
                        mode="time" 
                        display="default" 
                        onChange={handleTimeChange}
                        is24Hour={true}
                      />
                    )}
                  </>
                ) : (
                  <DateTimePicker 
                    value={editDateTime} 
                    mode="time" 
                    display="spinner" 
                    onChange={handleTimeChange}
                    style={{ width: '100%' }}
                    is24Hour={true}
                  />
                )}
                
                <View style={styles.modalButtons}>
                  <TouchableOpacity 
                    onPress={() => setEditModalVisible(false)}
                    style={[styles.modalButton, { backgroundColor: theme.secondary }]}
                  >
                    <Text style={[styles.modalButtonText, { color: theme.card }]}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    onPress={saveEdit}
                    style={[styles.modalButton, { backgroundColor: theme.primary }]}
                    disabled={saving}
                  >
                    {saving ? (
                      <ActivityIndicator size="small" color={theme.card} />
                    ) : (
                      <Text style={[styles.modalButtonText, { color: theme.card }]}>Save</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </>
            )}
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
    justifyContent: 'space-between',
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
    flex: 1,
  },
  deleteAllButton: {
    padding: 10,
    borderRadius: 8,
    marginRight: 5,
  },
  headerHighlight: {
    color: '#4A90E2',
  },
  elderNameHighlight: {
    fontSize: 22,
    fontWeight: 'bold',
  },
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 40,
    padding: 20,
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
  },
  errorContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 40,
    padding: 20,
  },
  errorText: {
    textAlign: 'center',
    marginBottom: 20,
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
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 60,
    padding: 40,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: 'bold',
    marginTop: 20,
  },
  emptySubtext: {
    fontSize: 14,
    marginTop: 10,
    textAlign: 'center',
  },
  containerCard: {
    borderRadius: 15,
    padding: 15,
    marginVertical: 8,
    width: '100%',
    elevation: 3,
  },
  containerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 10,
  },
  containerBadge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  containerBadgeText: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  medicationName: {
    fontSize: 16,
    fontWeight: '600',
    flex: 1,
  },
  pillCountContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.1)',
  },
  pillCountLabel: {
    fontSize: 14,
    fontWeight: '500',
  },
  pillCountControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  countButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  countButtonText: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  pillCountValue: {
    fontSize: 18,
    fontWeight: 'bold',
    minWidth: 30,
    textAlign: 'center',
  },
  lockedCountContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  lockButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    gap: 4,
    marginLeft: 8,
  },
  lockButtonText: {
    fontSize: 12,
    fontWeight: 'bold',
  },
  countInfoText: {
    fontSize: 12,
    marginTop: 4,
    fontStyle: 'italic',
  },
  scheduleList: {
    marginTop: 8,
    gap: 6,
  },
  scheduleItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 8,
    gap: 10,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusText: {
    fontSize: 11,
    fontWeight: 'bold',
  },
  scheduleTime: {
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
  },
  scheduleDate: {
    fontSize: 12,
    marginTop: 2,
  },
  editButton: {
    padding: 4,
  },
  deleteButton: {
    padding: 4,
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
    marginBottom: 20,
    textAlign: 'center',
  },
  editLabel: {
    fontSize: 16,
    marginBottom: 10,
    width: '100%',
  },
  timeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 15,
    borderRadius: 12,
    borderWidth: 2,
    marginBottom: 20,
    gap: 10,
    width: '100%',
  },
  timeButtonText: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  modalButton: {
    flex: 1,
    padding: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  modalButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
  },
});

export default ModifyScheduleScreen;

