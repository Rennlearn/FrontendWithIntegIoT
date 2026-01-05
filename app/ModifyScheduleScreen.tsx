import React, { useState, useEffect } from "react";
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Platform, ActivityIndicator, Alert, FlatList, Modal } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import BluetoothService from './services/BluetoothService';
import { useTheme } from './context/ThemeContext';
import { lightTheme, darkTheme } from './styles/theme';
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
  const [editTime, setEditTime] = useState<Date>(new Date());
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [editPillCount, setEditPillCount] = useState<Record<number, number>>({ 1: 0, 2: 0, 3: 0 });
  const [pillCountsLocked, setPillCountsLocked] = useState<Record<number, boolean>>({ 1: false, 2: false, 3: false });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadSchedules();
    loadMedications();
  }, []);

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      loadSchedules();
    });
    return unsubscribe;
  }, [navigation]);

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
      return 1;
    }
  };

  const loadMedications = async () => {
    try {
      const response = await fetch('https://pillnow-database.onrender.com/api/medications');
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const data = await response.json();
      const medsArray = Array.isArray(data) ? data : (data?.data || []);
      setMedications(medsArray);
    } catch (err) {
      console.error('Error fetching medications:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch medications');
    }
  };

  const loadSchedules = async () => {
    try {
      setLoading(true);
      setError(null);
      const userId = await getCurrentUserId();
      
      // Get token for authentication
      const token = await AsyncStorage.getItem('token');
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
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
      
      // Filter schedules by current user ID
      const schedulesArray = allSchedules.filter((schedule: any) => {
        const scheduleUserId = parseInt(schedule.user);
        return scheduleUserId === userId;
      });
      
      console.log(`[ModifyScheduleScreen] Loaded ${schedulesArray.length} schedule(s) for user ${userId}`);
      
      // Enrich schedules with medication names
      const enrichedSchedules = schedulesArray.map((schedule: Schedule) => {
        const medication = medications.find(med => med.medId === schedule.medication);
        return {
          ...schedule,
          medicationName: medication?.name || 'Unknown'
        };
      });
      
      setSchedules(enrichedSchedules);
      
      // Load pill counts from schedules (get max count per container from schedule data)
      // For now, we'll initialize from a default or load from a separate endpoint if available
      const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0 };
      const locked: Record<number, boolean> = { 1: false, 2: false, 3: false };
      enrichedSchedules.forEach((schedule: Schedule) => {
        // If schedule has a count field, use it; otherwise default to number of schedules
        const containerNum = schedule.container;
        const scheduleCount = enrichedSchedules.filter(s => s.container === containerNum).length;
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
  };

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
    // Parse time string (HH:MM) to Date
    const [hours, minutes] = schedule.time.split(':').map(Number);
    const editDate = new Date();
    editDate.setHours(hours);
    editDate.setMinutes(minutes);
    editDate.setSeconds(0);
    editDate.setMilliseconds(0);
    
    setEditingSchedule(schedule);
    setEditTime(editDate);
    setShowTimePicker(false);
    setEditModalVisible(true);
  };

  const handleTimeChange = (event: any, selected?: Date) => {
    if (Platform.OS === 'android') {
      if (event?.type === 'set' && selected) {
        setEditTime(selected);
        setShowTimePicker(false);
      } else if (event?.type === 'dismissed') {
        setShowTimePicker(false);
      }
    } else {
      if (selected) {
        setEditTime(selected);
      }
    }
  };

  const saveEdit = async () => {
    if (!editingSchedule) return;
    
    try {
      setSaving(true);
      
      // Update time format
      const newTime = `${String(editTime.getHours()).padStart(2, '0')}:${String(editTime.getMinutes()).padStart(2, '0')}`;
      
      // Update schedule in backend
      const updateData = {
        time: newTime,
        date: editingSchedule.date,
        status: editingSchedule.status,
        alertSent: editingSchedule.alertSent
      };
      
      const response = await fetch(`https://pillnow-database.onrender.com/api/medication_schedules/${editingSchedule._id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
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
          const userId = await getCurrentUserId();
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
            
            // Send all schedules to Arduino with retry logic
            for (const sched of scheduleList) {
              const command = `SCHED ADD ${sched.time} ${sched.container}\n`;
              console.log(`[ModifyScheduleScreen] Sending to Arduino: ${command.trim()}`);
              
              // Retry logic for Bluetooth corruption
              let retries = 3;
              let success = false;
              while (retries > 0 && !success) {
                success = await BluetoothService.sendCommand(command);
                if (!success && retries > 1) {
                  console.warn(`[ModifyScheduleScreen] Command failed, retrying... (${retries - 1} attempts left)`);
                  await new Promise(resolve => setTimeout(resolve, 500)); // Wait before retry
                }
                retries--;
              }
              
              if (!success) {
                console.error(`[ModifyScheduleScreen] Failed to send schedule after 3 attempts: ${sched.time} C${sched.container}`);
              }
              
              await new Promise(resolve => setTimeout(resolve, 400)); // Increased delay between commands
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
                  const userId = await getCurrentUserId();
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
                      const command = `SCHED ADD ${sched.time} ${sched.container}\n`;
                      console.log(`[ModifyScheduleScreen] Sending to Arduino: ${command.trim()}`);
                      
                      // Retry logic for Bluetooth corruption
                      let retries = 3;
                      let success = false;
                      while (retries > 0 && !success) {
                        success = await BluetoothService.sendCommand(command);
                        if (!success && retries > 1) {
                          console.warn(`[ModifyScheduleScreen] Command failed, retrying... (${retries - 1} attempts left)`);
                          await new Promise(resolve => setTimeout(resolve, 500)); // Wait before retry
                        }
                        retries--;
                      }
                      
                      if (!success) {
                        console.error(`[ModifyScheduleScreen] Failed to send schedule after 3 attempts: ${sched.time} C${sched.container}`);
                      }
                      
                      await new Promise(resolve => setTimeout(resolve, 400)); // Increased delay between commands
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
            }
          }
        }
      ]
    );
  };

  // Group schedules by container
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
        <Text style={[styles.headerTitle, { color: theme.secondary }]}>
          MODIFY <Text style={[styles.headerHighlight, { color: theme.primary }]}>SCHEDULE</Text>
        </Text>
        {schedules.length > 0 && (
          <TouchableOpacity 
            style={[styles.deleteAllButton, { backgroundColor: theme.error }]}
            onPress={deleteAllSchedules}
          >
            <Ionicons name="trash" size={20} color={theme.card} />
          </TouchableOpacity>
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
                  return (
                    <View key={schedule._id} style={[styles.scheduleItem, { backgroundColor: theme.background }]}>
                      <Ionicons name="alarm" size={16} color={theme.primary} />
                      <Text style={[styles.scheduleTime, { color: theme.text }]}>{timeStr}</Text>
                      <TouchableOpacity 
                        onPress={() => openEditModal(schedule)}
                        style={styles.editButton}
                      >
                        <Ionicons name="create-outline" size={18} color={theme.primary} />
                      </TouchableOpacity>
                      <TouchableOpacity 
                        onPress={() => deleteSchedule(schedule._id)}
                        style={styles.deleteButton}
                      >
                        <Ionicons name="trash-outline" size={18} color={theme.error} />
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
                
                <Text style={[styles.editLabel, { color: theme.text }]}>Time:</Text>
                {Platform.OS === 'android' ? (
                  <>
                    <TouchableOpacity 
                      onPress={() => setShowTimePicker(true)}
                      style={[styles.timeButton, { backgroundColor: theme.background, borderColor: theme.primary }]}
                    >
                      <Ionicons name="time-outline" size={24} color={theme.primary} />
                      <Text style={[styles.timeButtonText, { color: theme.text }]}>
                        {editTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}
                      </Text>
                    </TouchableOpacity>
                    {showTimePicker && (
                      <DateTimePicker 
                        value={editTime} 
                        mode="time" 
                        display="default" 
                        onChange={handleTimeChange}
                        is24Hour={true}
                      />
                    )}
                  </>
                ) : (
                  <DateTimePicker 
                    value={editTime} 
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
  scheduleTime: {
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
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

