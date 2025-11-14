import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  FlatList,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Platform,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from './context/ThemeContext';
import { lightTheme, darkTheme } from './styles/theme';
import AsyncStorage from "@react-native-async-storage/async-storage";
import { jwtDecode } from "jwt-decode";

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

// Type for saved schedule data
interface SavedSchedule {
  selectedPills: Record<number, string | null>;
  alarms: Record<number, string[]>; // Store as ISO strings
}

// Interface for decoded JWT token
interface DecodedToken {
  id: string;
  userId?: string;
  role?: string;
}

const ModifyButton = () => {
  const navigation = useNavigation();
  const { isDarkMode } = useTheme();
  const theme = isDarkMode ? darkTheme : lightTheme;
  const [pillModalVisible, setPillModalVisible] = useState(false);
  const [alarmModalVisible, setAlarmModalVisible] = useState(false);
  const [confirmModalVisible, setConfirmModalVisible] = useState(false);
  const [selectedPills, setSelectedPills] = useState<Record<number, string | null>>({ 1: null, 2: null, 3: null });
  const [alarms, setAlarms] = useState<Record<number, Date[]>>({ 1: [], 2: [], 3: [] });
  const [currentPillSlot, setCurrentPillSlot] = useState<number | null>(null);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  
  // New state for API data and loading
  const [medications, setMedications] = useState<Medication[]>([]);
  const [schedules, setSchedules] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<any>(null);
  const [editMedication, setEditMedication] = useState<string>('');
  const [editDate, setEditDate] = useState<string>('');
  const [editTime, setEditTime] = useState<string>('');
  const [showEditDatePicker, setShowEditDatePicker] = useState(false);
  const [showEditTimePicker, setShowEditTimePicker] = useState(false);

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

  // Load saved data and fetch medications on component mount
  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        setError(null);
        
        // First fetch medications
        const medicationsResponse = await fetch('https://pillnow-database.onrender.com/api/medications');
        if (!medicationsResponse.ok) {
          throw new Error(`Failed to fetch medications: ${medicationsResponse.status}`);
        }
        const medicationsData = await medicationsResponse.json();
        const medsArray = Array.isArray(medicationsData) ? medicationsData : (medicationsData?.data || []);
        setMedications(medsArray);
        
        // Then load saved data and fetch schedules
        await loadSavedData();
        await loadScheduleData();
      } catch (err) {
        console.error('Error in loadData:', err);
        setError(err instanceof Error ? err.message : 'Failed to load data');
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  // Load schedule data from database (same as Monitor & Manage)
  const loadScheduleData = async () => {
    try {
      const schedulesResponse = await fetch('https://pillnow-database.onrender.com/api/medication_schedules', {
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
          'If-Modified-Since': '0'
        }
      });
      const schedulesData = await schedulesResponse.json();
      
      // Get all schedules and show the latest ones (no user/status filtering) - same as Monitor & Manage
      const allSchedules = schedulesData.data || [];
      
      // Sort by schedule ID (highest first) and take top 3, then arrange by container number - same as Monitor & Manage
      const sortedSchedules = allSchedules
        .sort((a: any, b: any) => b.scheduleId - a.scheduleId) // Sort by highest schedule ID first
        .slice(0, 3) // Take top 3 highest schedule IDs
        .sort((a: any, b: any) => {
          // Then arrange by container number (1, 2, 3)
          const containerA = parseInt(a.container);
          const containerB = parseInt(b.container);
          return containerA - containerB;
        });
      
      setSchedules(sortedSchedules);
    } catch (error) {
      console.error('Error loading schedule data:', error);
    }
  };

  // Load saved schedule data from database
  const loadSavedData = async () => {
    try {
      const response = await fetch('https://pillnow-database.onrender.com/api/medication_schedules');
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const responseData = await response.json();
      
      // Extract the actual schedules array from the response
      const schedules = responseData.data || [];
      
      if (schedules && schedules.length > 0) {
        const currentUserId = await getCurrentUserId();
        const userSchedules = schedules.filter((s: any) => s.user === currentUserId);
        
        // Group schedules by container and reconstruct our app format
        const selectedPills: Record<number, string | null> = { 1: null, 2: null, 3: null };
        const convertedAlarms: Record<number, Date[]> = { 1: [], 2: [], 3: [] };
        
        // Group schedules by container
        const schedulesByContainer: Record<number, any[]> = {};
        userSchedules.forEach((schedule: any) => {
          const containerNum = schedule.container || 1; // Default to container 1 if not specified
          if (!schedulesByContainer[containerNum]) {
            schedulesByContainer[containerNum] = [];
          }
          schedulesByContainer[containerNum].push(schedule);
        });
        

        
        // Process each container
        for (let containerNum = 1; containerNum <= 3; containerNum++) {
          const containerSchedules = schedulesByContainer[containerNum] || [];
          
          if (containerSchedules.length > 0) {
            // Sort schedules for this container by most recent timestamp
            const sortedForContainer = [...containerSchedules].sort((a: any, b: any) => {
              const aTs = new Date(`${a.date}T${a.time}`).getTime();
              const bTs = new Date(`${b.date}T${b.time}`).getTime();
              return bTs - aTs;
            });

            // Determine the latest date for this container
            const latestDate = sortedForContainer.length > 0 ? sortedForContainer[0].date : null;

            // Use only schedules from the latest date as the "latest schedule set"
            const latestSet = latestDate
              ? sortedForContainer.filter((s: any) => s.date === latestDate)
              : [];

            // Determine medication name from latest set's first item
            const firstLatest = latestSet[0] || sortedForContainer[0];
            let medicationName: string | null = null;
            const medField = firstLatest?.medication;
            if (typeof medField === 'string') {
              // If medField matches a known med name, use it. Else if it matches an id, map to name. Else use as-is.
              const byName = medications.find(m => m.name === medField);
              if (byName) {
                medicationName = byName.name;
              } else {
                const byId = medications.find(m => m._id?.toString() === medField);
                medicationName = byId ? byId.name : medField;
              }
            } else if (typeof medField === 'number') {
              const byId = medications.find(m => m._id?.toString() === medField.toString());
              medicationName = byId ? byId.name : null;
            }

            if (medicationName) {
              selectedPills[containerNum] = medicationName;
              // Build alarms from latest set
              const alarmDates = latestSet.map((schedule: any) => {
                const dateStr = schedule.date;
                const timeStr = schedule.time;
                return new Date(`${dateStr}T${timeStr}`);
              });
              convertedAlarms[containerNum] = alarmDates;
            }
          }
        }
        
        setSelectedPills(selectedPills);
        setAlarms(convertedAlarms);
      }
    } catch (err) {
      console.error('Error loading saved data:', err);
      setError('Failed to load saved schedule from database');
    }
  };



  // Save schedule data to database
  const saveScheduleData = async () => {
    try {
      setSaving(true);
      
      const currentUserId = await getCurrentUserId();
      
      // First, get existing schedules to determine which ones to update vs create
      const existingSchedulesResponse = await fetch('https://pillnow-database.onrender.com/api/medication_schedules');
      const existingSchedulesData = await existingSchedulesResponse.json();
      const existingSchedules = existingSchedulesData.data || [];
      
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
        const pillName = selectedPills[containerNum];
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
      
      // Process each schedule record - update existing or create new
      const promises = scheduleRecords.map(async (record, index) => {
        // Check if there's an existing schedule for this container and time slot
        const existingSchedule = existingSchedules.find((existing: any) => 
          existing.container === record.container && 
          existing.user === record.user &&
          existing.medication === record.medication
        );
        
        if (existingSchedule) {
          // Update existing schedule using PUT
          return fetch(`https://pillnow-database.onrender.com/api/medication_schedules/${existingSchedule._id}`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              ...record,
              scheduleId: existingSchedule.scheduleId // Keep the existing scheduleId
            }),
          });
        } else {
          // Create new schedule using POST
          return fetch('https://pillnow-database.onrender.com/api/medication_schedules', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(record),
          });
        }
      });
      
      const responses = await Promise.all(promises);
      
      // Check if all requests were successful
      const failedResponses = responses.filter(response => !response.ok);
      if (failedResponses.length > 0) {
        const errorText = await failedResponses[0].text();
        console.error('API Error Response:', errorText);
        throw new Error(`HTTP error! status: ${failedResponses[0].status} - ${errorText}`);
      }
      
      const results = await Promise.all(responses.map(response => response.json()));
      Alert.alert('Success', 'Schedule updated successfully!');
      
      // Refresh the schedule data to show the updated schedules
      await loadScheduleData();
    } catch (err) {
      console.error('Error saving schedule:', err);
      Alert.alert('Error', `Failed to save schedule: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setSaving(false);
    }
  };

  const handlePillEdit = (slot: number) => {
    setCurrentPillSlot(slot);
    setPillModalVisible(true);
  };

  const handlePillSelection = (pill: string) => {
    if (currentPillSlot !== null) {
      setSelectedPills((prev) => ({ ...prev, [currentPillSlot]: pill }));
    }
    setPillModalVisible(false);
  };

  const handleEditAlarm = (slot: number) => {
    setCurrentPillSlot(slot);
    setAlarmModalVisible(true);
  };

  const onChangeDate = (_event: any, selected: Date | undefined) => {
    if (selected && currentPillSlot !== null) {
      setSelectedDate(selected);
      setAlarms((prev) => {
        const updatedAlarms = [...prev[currentPillSlot]];
        updatedAlarms.push(selected);
        return { ...prev, [currentPillSlot]: updatedAlarms };
      });
    }
    setShowDatePicker(false);
  };

  const removeAlarm = (slot: number, index: number) => {
    setAlarms((prev) => {
      const updatedAlarms = [...prev[slot]];
      updatedAlarms.splice(index, 1);
      return { ...prev, [slot]: updatedAlarms };
    });
  };

  const clearPillSlot = (slot: number) => {
    Alert.alert(
      'Clear Slot',
      'Are you sure you want to clear this pill slot?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => {
            setSelectedPills(prev => ({ ...prev, [slot]: null }));
            setAlarms(prev => ({ ...prev, [slot]: [] }));
          }
        }
      ]
    );
  };

  const handleEditSchedule = (schedule: any) => {
    // Find the medication name
    const medication = medications.find(med => med.medId === schedule.medication);
    const medicationName = medication ? medication.name : `ID: ${schedule.medication}`;
    
    // Set the editing schedule and form values
    setEditingSchedule(schedule);
    setEditMedication(medicationName);
    setEditDate(schedule.date);
    setEditTime(schedule.time);
    setEditModalVisible(true);
  };

  const handleEditDateChange = (event: any, selected?: Date) => {
    if (Platform.OS === 'android') {
      if (event?.type === 'set' && selected) {
        setEditDate(selected.toISOString().split('T')[0]);
      }
      setShowEditDatePicker(false);
    } else {
      if (selected) {
        setEditDate(selected.toISOString().split('T')[0]);
      }
      setShowEditDatePicker(false);
    }
  };

  const handleEditTimeChange = (event: any, selected?: Date) => {
    if (Platform.OS === 'android') {
      if (event?.type === 'set' && selected) {
        setEditTime(selected.toTimeString().split(' ')[0].substring(0, 5));
      }
      setShowEditTimePicker(false);
    } else {
      if (selected) {
        setEditTime(selected.toTimeString().split(' ')[0].substring(0, 5));
      }
      setShowEditTimePicker(false);
    }
  };

  const handleSaveEdit = async () => {
    try {
      if (!editingSchedule) return;
      
      // Find the medication ID from the name
      const medication = medications.find(med => med.name === editMedication);
      if (!medication) {
        Alert.alert('Error', 'Selected medication not found');
        return;
      }

      // Get current user ID
      const currentUserId = await getCurrentUserId();

      // Create updated schedule data using the existing schedule ID
      const updatedSchedule = {
        scheduleId: editingSchedule.scheduleId, // Use existing schedule ID
        user: currentUserId,
        medication: medication.medId,
        container: editingSchedule.container,
        date: editDate,
        time: editTime,
        status: 'Pending',
        alertSent: false
      };

      // Send PUT request to update the existing schedule using MongoDB _id
      const response = await fetch(`https://pillnow-database.onrender.com/api/medication_schedules/${editingSchedule._id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updatedSchedule),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('API Error Response:', errorText);
        throw new Error(`HTTP error! status: ${response.status} - ${errorText}`);
      }

      // Update the schedule in the local state
      setSchedules(prevSchedules => 
        prevSchedules.map(schedule => 
          schedule._id === editingSchedule._id 
            ? updatedSchedule 
            : schedule
        )
      );

      Alert.alert('Success', 'Schedule updated successfully!');
      setEditModalVisible(false);
      setEditingSchedule(null);
    } catch (error) {
      console.error('Error updating schedule:', error);
      Alert.alert('Error', `Failed to update schedule: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleDeleteSchedule = (scheduleId: string) => {
    Alert.alert(
      'Delete Schedule',
      'Are you sure you want to delete this schedule? This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const resp = await fetch(`https://pillnow-database.onrender.com/api/medication_schedules/${scheduleId}`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
              });
              if (!resp.ok) {
                const txt = await resp.text();
                throw new Error(`HTTP ${resp.status} ${txt}`);
              }
              // Remove locally and refresh from backend to be sure
              setSchedules(prev => prev.filter(s => s._id !== scheduleId));
              await loadScheduleData();
              Alert.alert('Deleted', 'Schedule deleted successfully.');
            } catch (err) {
              console.error('Error deleting schedule:', err);
              Alert.alert('Error', `Failed to delete schedule: ${err instanceof Error ? err.message : 'Unknown error'}`);
            }
          }
        }
      ]
    );
  };

  const clearAllData = () => {
    Alert.alert(
      'Clear All Data',
      'Are you sure you want to clear all saved schedule data? This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear All',
          style: 'destructive',
          onPress: async () => {
            try {
              // Note: You'll need to implement a DELETE endpoint on your backend
              // For now, we'll just clear the local state
              // TODO: Add DELETE /api/medication_schedules endpoint to clear all schedules
              
              setSelectedPills({ 1: null, 2: null, 3: null });
              setAlarms({ 1: [], 2: [], 3: [] });
              Alert.alert('Success', 'All data cleared from local state! Note: You may need to implement a DELETE endpoint to clear from database.');
            } catch (err) {
              console.error('Error clearing data:', err);
              Alert.alert('Error', `Failed to clear data: ${err instanceof Error ? err.message : 'Unknown error'}`);
            }
          }
        }
      ]
    );
  };

  return (
    <ScrollView style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { backgroundColor: theme.card }]}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={30} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.secondary }]}>
          MODIFY <Text style={[styles.headerHighlight, { color: theme.primary }]}>SCHEDULE</Text>
        </Text>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.primary} />
          <Text style={[styles.loadingText, { color: theme.text }]}>Loading saved schedule...</Text>
        </View>
      ) : error ? (
        <View style={styles.errorContainer}>
          <Text style={[styles.errorText, { color: theme.text }]}>{error}</Text>
                     <TouchableOpacity 
             style={[styles.retryButton, { backgroundColor: theme.primary }]}
             onPress={() => {
               const loadData = async () => {
                 try {
                   setLoading(true);
                   setError(null);
                   
                   // First fetch medications
                   const medicationsResponse = await fetch('https://pillnow-database.onrender.com/api/medications');
                   if (!medicationsResponse.ok) {
                     throw new Error(`Failed to fetch medications: ${medicationsResponse.status}`);
                   }
                   const medicationsData = await medicationsResponse.json();
                   setMedications(medicationsData);
                   
                   // Then load saved data
                   await loadSavedData();
                 } catch (err) {
                   console.error('Error in retry:', err);
                   setError(err instanceof Error ? err.message : 'Failed to load data');
                 } finally {
                   setLoading(false);
                 }
               };
               loadData();
             }}
           >
            <Text style={[styles.retryButtonText, { color: theme.card }]}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          {/* Current Schedule Display Section */}
          <View style={[styles.scheduleSection, { backgroundColor: theme.card }]}>
            <Text style={[styles.sectionTitle, { color: theme.secondary }]}>
              Current Scheduled ({schedules.length} schedules)
            </Text>
            
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
                          <View style={styles.scheduleActions}>
                            <View style={[
                              styles.statusBadge, 
                              { backgroundColor: schedule.status === 'Pending' ? theme.warning : theme.success }
                            ]}>
                              <Text style={[styles.statusText, { color: theme.card }]}>
                                {schedule.status}
                              </Text>
                            </View>
                            <TouchableOpacity 
                              style={[styles.editButton, { backgroundColor: theme.primary }]}
                              onPress={() => handleEditSchedule(schedule)}
                            >
                              <Ionicons name="pencil" size={16} color={theme.card} />
                            </TouchableOpacity>
                            <TouchableOpacity 
                              style={[styles.deleteButton, { backgroundColor: theme.error }]}
                              onPress={() => handleDeleteSchedule(schedule._id)}
                            >
                              <Ionicons name="trash" size={16} color={theme.card} />
                            </TouchableOpacity>
                          </View>
                        </View>
                        
                        <View style={styles.scheduleDetails}>
                          <Text style={[styles.detailText, { color: theme.text }]}>
                            <Text style={styles.label}>Medication:</Text> {medicationName}
                          </Text>
                          <Text style={[styles.detailText, { color: theme.text }]}>
                            <Text style={styles.label}>Date:</Text> {schedule.date}
                          </Text>
                          <Text style={[styles.detailText, { color: theme.text }]}>
                            <Text style={styles.label}>Time:</Text> {schedule.time}
                          </Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}
          </View>
          
          {/* Action Buttons */}
          <View style={styles.actionButtonsContainer}>
            <TouchableOpacity 
              style={[styles.updateCurrentButton, { backgroundColor: theme.secondary }]}
              onPress={saveScheduleData}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator size="small" color={theme.card} />
              ) : (
                <Text style={[styles.updateCurrentButtonText, { color: theme.card }]}>Update Current Schedule</Text>
              )}
            </TouchableOpacity>
            
            <TouchableOpacity 
              style={[styles.clearAllButton, { backgroundColor: theme.error }]}
              onPress={clearAllData}
            >
              <Text style={[styles.clearAllButtonText, { color: theme.card }]}>Clear All Data</Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      {/* Pill Selection Modal */}
      <Modal visible={pillModalVisible} transparent animationType="slide">
        <View style={[styles.modalOverlay, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
          <View style={[styles.modalContent, { backgroundColor: theme.card }]}>
            <Text style={[styles.modalTitle, { color: theme.secondary }]}>Select a Medication</Text>

            <FlatList
              data={medications}
              keyExtractor={(item) => item._id}
              style={{ maxHeight: 300, width: '100%' }}
              renderItem={({ item }) => (
                <TouchableOpacity 
                  onPress={() => handlePillSelection(item.name)} 
                  style={[styles.modalItem, { borderBottomColor: theme.border }]}
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
              style={[styles.cancelButton, { backgroundColor: theme.error }]}
            >
              <Text style={[styles.cancelButtonText, { color: theme.card }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Alarm Modal */}
      <Modal visible={alarmModalVisible} transparent animationType="slide">
        <View style={[styles.modalOverlay, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
          <View style={[styles.modalContent, { backgroundColor: theme.card }]}>
            <Text style={[styles.modalTitle, { color: theme.secondary }]}>Add Alarm</Text>
            <TouchableOpacity onPress={() => setShowDatePicker(true)}>
              <Text style={[styles.datePickerText, { color: theme.primary }]}>Pick Date & Time</Text>
            </TouchableOpacity>
            {showDatePicker && (
              <DateTimePicker
                value={new Date()}
                mode="datetime"
                display="default"
                onChange={onChangeDate}
              />
            )}
            <TouchableOpacity 
              onPress={() => setAlarmModalVisible(false)} 
              style={[styles.confirmButton, { backgroundColor: theme.success }]}
            >
              <Text style={[styles.confirmButtonText, { color: theme.card }]}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Edit Schedule Modal */}
      <Modal visible={editModalVisible} transparent animationType="slide">
        <View style={[styles.modalOverlay, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
          <View style={[styles.modalContent, { backgroundColor: theme.card }]}>
            <Text style={[styles.modalTitle, { color: theme.secondary }]}>Edit Schedule</Text>
            
            {/* Container Info */}
            <Text style={[styles.editLabel, { color: theme.text }]}>
              Container: {editingSchedule?.container}
            </Text>
            
            {/* Medication Selection */}
            <Text style={[styles.editLabel, { color: theme.text }]}>Medication:</Text>
            <FlatList
              data={medications}
              keyExtractor={(item) => item._id}
              style={{ maxHeight: 150, width: '100%', marginBottom: 10 }}
              renderItem={({ item }) => (
                <TouchableOpacity 
                  onPress={() => setEditMedication(item.name)} 
                  style={[
                    styles.editMedicationItem, 
                    { 
                      borderBottomColor: theme.border,
                      backgroundColor: editMedication === item.name ? theme.primary : 'transparent'
                    }
                  ]}
                >
                  <Text style={[
                    styles.editMedicationText, 
                    { color: editMedication === item.name ? theme.card : theme.text }
                  ]}>
                    {item.name} - {item.dosage} {item.form}
                  </Text>
                </TouchableOpacity>
              )}
            />
            
            {/* Date Selection */}
            <Text style={[styles.editLabel, { color: theme.text }]}>Date: {editDate}</Text>
            <TouchableOpacity 
              onPress={() => setShowEditDatePicker(true)}
              style={[styles.editPickerButton, { backgroundColor: theme.primary }]}
            >
              <Text style={[styles.editPickerText, { color: theme.card }]}>Change Date</Text>
            </TouchableOpacity>
            
            {/* Time Selection */}
            <Text style={[styles.editLabel, { color: theme.text }]}>Time: {editTime}</Text>
            <TouchableOpacity 
              onPress={() => setShowEditTimePicker(true)}
              style={[styles.editPickerButton, { backgroundColor: theme.primary }]}
            >
              <Text style={[styles.editPickerText, { color: theme.card }]}>Change Time</Text>
            </TouchableOpacity>
            
            {/* Date/Time Pickers */}
            {showEditDatePicker && (
              <DateTimePicker
                value={new Date(editDate)}
                mode="date"
                display="default"
                onChange={handleEditDateChange}
              />
            )}
            {showEditTimePicker && (
              <DateTimePicker
                value={new Date(`2000-01-01T${editTime}`)}
                mode="time"
                display="default"
                onChange={handleEditTimeChange}
              />
            )}
            
            {/* Action Buttons */}
            <View style={styles.editModalActions}>
              <TouchableOpacity 
                onPress={() => setEditModalVisible(false)} 
                style={[styles.cancelButton, { backgroundColor: theme.error }]}
              >
                <Text style={[styles.cancelButtonText, { color: theme.card }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                onPress={handleSaveEdit} 
                style={[styles.confirmButton, { backgroundColor: theme.success }]}
              >
                <Text style={[styles.confirmButtonText, { color: theme.card }]}>Save Changes</Text>
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
    padding: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    padding: 15,
    borderRadius: 15,
    elevation: 8,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    marginLeft: 10,
  },
  headerHighlight: {
    color: '#4A90E2',
  },
  pillContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 15,
    borderRadius: 12,
    marginVertical: 10,
    elevation: 2,
  },
  pillInfo: {
    flex: 1,
  },
  actionButtons: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillText: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  alarmText: {
    fontSize: 14,
    marginTop: 5,
  },
  alarmRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 5,
  },
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 50,
    padding: 20,
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
  },
  errorContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 50,
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
  saveButton: {
    padding: 15,
    borderRadius: 12,
    marginTop: 20,
    width: '100%',
    alignItems: 'center',
    elevation: 3,
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  clearAllButton: {
    padding: 15,
    borderRadius: 12,
    marginTop: 10,
    width: '100%',
    alignItems: 'center',
    elevation: 3,
  },
  clearAllButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  scheduleSection: {
    marginTop: 20,
    padding: 15,
    borderRadius: 15,
    elevation: 5,
  },
  editSection: {
    marginTop: 20,
    padding: 15,
    borderRadius: 15,
    elevation: 5,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 10,
    paddingBottom: 5,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
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
  actionButtonsContainer: {
    marginTop: 20,
    alignItems: 'center',
  },
  updateButton: {
    padding: 15,
    borderRadius: 12,
    marginBottom: 10,
    width: '100%',
    alignItems: 'center',
    elevation: 3,
  },
  updateButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  updateCurrentButton: {
    padding: 15,
    borderRadius: 12,
    marginBottom: 10,
    width: '100%',
    alignItems: 'center',
    elevation: 3,
  },
  updateCurrentButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  scheduleActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  editButton: {
    padding: 6,
    borderRadius: 8,
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  deleteButton: {
    padding: 6,
    borderRadius: 8,
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    borderRadius: 12,
    padding: 20,
    width: 350,
    maxHeight: 500,
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 15,
  },
  modalItem: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    width: '100%',
  },
  modalItemText: {
    fontSize: 16,
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
  cancelButton: {
    marginTop: 15,
    padding: 10,
    borderRadius: 8,
    width: '100%',
    alignItems: 'center',
  },
  cancelButtonText: {
    fontWeight: 'bold',
  },
  datePickerText: {
    fontSize: 16,
    marginBottom: 10,
  },
  confirmButton: {
    padding: 12,
    borderRadius: 8,
    marginTop: 10,
    width: '100%',
    alignItems: 'center',
  },
  confirmButtonText: {
    fontWeight: 'bold',
  },

  editLabel: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 8,
    marginTop: 10,
  },
  editMedicationItem: {
    paddingVertical: 10,
    paddingHorizontal: 15,
    borderBottomWidth: 1,
    borderRadius: 8,
    marginBottom: 5,
  },
  editMedicationText: {
    fontSize: 16,
  },
  editPickerButton: {
    padding: 10,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 10,
  },
  editPickerText: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  editModalActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 20,
    gap: 10,
  },
});

export default ModifyButton;
