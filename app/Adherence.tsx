import React, { useEffect, useState } from 'react';
import { 
  View, Text, StyleSheet, ScrollView, TouchableOpacity, 
  Modal, FlatList, ActivityIndicator, Alert
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme } from './context/ThemeContext';
import { lightTheme, darkTheme } from './styles/theme';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { jwtDecode } from 'jwt-decode';

// Interface for decoded JWT token
interface DecodedToken {
  id: string;
  userId?: string;
  role?: string;
}

interface MedicationRow {
  _id: string;
  containerId: number;
  medicineName: string;
  scheduledTime: string;
  date: string;
  status: 'Taken' | 'Pending' | 'Missed';
}

const Adherence = () => {
  const router = useRouter();
  const { isDarkMode } = useTheme();
  const theme = isDarkMode ? darkTheme : lightTheme;
  const [loading, setLoading] = useState<boolean>(true);
  const [medications, setMedications] = useState<MedicationRow[]>([]);
  const [selectedMedication, setSelectedMedication] = useState<MedicationRow | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [filterMode, setFilterMode] = useState<'7d' | 'all' | 'custom'>('7d');
  const [customStart, setCustomStart] = useState<Date>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    return d;
  });
  const [customEnd, setCustomEnd] = useState<Date>(new Date());
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);
  const [isCaregiver, setIsCaregiver] = useState(false);
  const [monitoringElder, setMonitoringElder] = useState<{ id: string; name: string } | null>(null);

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

  const fetchAdherenceData = async () => {
    try {
      setLoading(true);
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

      const currentUserId = await getCurrentUserId();
      const userRole = await getUserRole();
      const selectedElderId = await getSelectedElderId();
      
      // Strict check: Only role '3' is caregiver, role '2' is elder
      const roleStr = userRole ? String(userRole) : '';
      const isCaregiver = roleStr === '3' && roleStr !== '2';
      const isElder = roleStr === '2';
      
      // If user is an elder, clear any selectedElderId (elders don't select other elders)
      if (isElder) {
        await AsyncStorage.removeItem('selectedElderId');
        await AsyncStorage.removeItem('selectedElderName');
        console.log('[Adherence] Cleared selectedElderId for elder user');
      }

      let userSchedules: any[] = [];
      let elderInfo: { id: string; name: string; email?: string; phone?: string; age?: number } | null = null;

      if (isCaregiver && selectedElderId) {
        // Caregiver: Use new endpoint to get elder's adherence data
        try {
          const response = await fetch(`https://pillnow-database.onrender.com/api/monitor/elder-device/${selectedElderId}`, {
            headers
          });

          if (response.status === 401) {
            Alert.alert(
              'Authentication Required',
              'Your session has expired. Please log in again.',
              [{ text: 'OK', onPress: () => router.replace('/LoginScreen') }]
            );
            return;
          }

          if (response.status === 403) {
            Alert.alert(
              'Permission Denied',
              'You do not have permission to view this elder\'s adherence. Please check your caregiver-elder connection.',
              [{ text: 'OK' }]
            );
            return;
          }

          if (response.status === 404) {
            Alert.alert(
              'No Device Connection',
              'This elder does not have an active device connection. Please connect a device first.',
              [{ text: 'OK' }]
            );
            return;
          }

          if (!response.ok) {
            const errorText = await response.text();
            console.error(`[Adherence] API error (${response.status}): ${errorText}`);
            Alert.alert('Error', `Failed to load adherence data: ${response.status}`);
            return;
          }

          const responseData = await response.json();
          if (responseData.success && responseData.data) {
            elderInfo = responseData.data.elder;
            // Extract schedules from devices array
            const devices = responseData.data.devices || [];
            if (devices.length > 0 && devices[0].monitoring) {
              // For now, we'll still fetch schedules from the schedules endpoint
              // The monitoring data provides statistics, but we need individual schedule records
              const schedulesResp = await fetch('https://pillnow-database.onrender.com/api/medication_schedules', {
                headers
              });
              const schedulesJson = await schedulesResp.json();
              const allSchedules: any[] = schedulesJson?.data || [];
              userSchedules = allSchedules.filter((schedule: any) => {
                const scheduleUserId = parseInt(schedule.user);
                return scheduleUserId === parseInt(selectedElderId);
              });
              console.log(`[Adherence] Caregiver viewing elder ${selectedElderId}'s adherence: ${userSchedules.length} schedule(s)`);
            }
          }
        } catch (error) {
          console.error('[Adherence] Error fetching elder adherence:', error);
          Alert.alert('Error', 'Failed to load adherence data. Please try again.');
          return;
        }
      } else if (isCaregiver && !selectedElderId) {
        // Caregiver but no elder selected
        setMedications([]);
        return;
      } else {
        // Elder: show own schedules using traditional endpoint
        const schedulesResp = await fetch('https://pillnow-database.onrender.com/api/medication_schedules', {
          headers
        });
        const schedulesJson = await schedulesResp.json();
        const allSchedules: any[] = schedulesJson?.data || [];
        userSchedules = allSchedules.filter((schedule: any) => {
          const scheduleUserId = parseInt(schedule.user);
          return scheduleUserId === currentUserId;
        });
        console.log(`[Adherence] Elder viewing own adherence: ${userSchedules.length} schedule(s)`);
      }

      const medsResp = await fetch('https://pillnow-database.onrender.com/api/medications');
      const medsJson = await medsResp.json();
      const medsArray: any[] = Array.isArray(medsJson) ? medsJson : (medsJson?.data || []);

      const now = new Date();
      const rows: MedicationRow[] = userSchedules.map((s) => {
        const med = medsArray.find(m => m.medId === s.medication);
        const [y, m, d] = String(s.date).split('-').map(Number);
        const [hh, mm] = String(s.time).split(':').map(Number);
        const when = new Date(y, (m || 1) - 1, d, hh, mm);
        // Map backend status 'Done' to display status 'Taken'
        let status: 'Taken' | 'Pending' | 'Missed' = (s.status === 'Done' || s.status === 'Taken') ? 'Taken' : 'Pending';
        if (status === 'Pending' && now.getTime() > when.getTime()) status = 'Missed';
        return {
          _id: s._id,
          containerId: Number(s.container) || 1,
          medicineName: med ? med.name : `ID: ${s.medication}`,
          scheduledTime: s.time,
          date: s.date,
          status,
        };
      });
      setMedications(rows);
      
      // Store elder info for display
      if (elderInfo) {
        await AsyncStorage.setItem('selectedElderName', elderInfo.name);
        setMonitoringElder({ id: elderInfo.id, name: elderInfo.name });
      } else {
        setMonitoringElder(null);
      }
      
      // Update caregiver status
      setIsCaregiver(isCaregiver);
    } catch (e) {
      console.error('[Adherence] Error:', e);
      Alert.alert('Error', 'Failed to load adherence data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAdherenceData();
    // Check monitoring status on mount
    checkMonitoringStatusOnMount();
  }, []);

  // Check monitoring status on mount
  const checkMonitoringStatusOnMount = async () => {
    try {
      const userRole = await getUserRole();
      const selectedElderId = await getSelectedElderId();
      
      // Strict check: Only role '3' is caregiver, role '2' is elder
      const roleStr = userRole ? String(userRole) : '';
      const isCaregiverUser = roleStr === '3';
      const isElderUser = roleStr === '2';
      
      // Only show as caregiver if user is actually a caregiver (not elder)
      const shouldShowAsCaregiver = isCaregiverUser && !isElderUser;
      
      // If user is an elder, clear any selectedElderId (elders don't select other elders)
      if (isElderUser) {
        await AsyncStorage.removeItem('selectedElderId');
        await AsyncStorage.removeItem('selectedElderName');
        console.log('[Adherence] Cleared selectedElderId for elder user');
      }
      
      setIsCaregiver(shouldShowAsCaregiver);
      
      // Only set monitoring elder if user is actually a caregiver
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

  const getFilteredMedications = () => {
    if (filterMode === 'all') return medications;
    const now = new Date();
    const start = filterMode === '7d' ? new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6) : customStart;
    const end = filterMode === '7d' ? now : customEnd;
    const startMs = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 0, 0, 0, 0).getTime();
    const endMs = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59, 999).getTime();
    return medications.filter((m) => {
      const [y, mo, d] = String(m.date).split('-').map(Number);
      const when = new Date(y, (mo || 1) - 1, d).getTime();
      return when >= startMs && when <= endMs;
    });
  };

  const handleMarkAsTaken = async (medication: MedicationRow) => {
    try {
      const token = await AsyncStorage.getItem('token');
      const headers: HeadersInit = {
        'Content-Type': 'application/json'
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token.trim()}`;
      }
      // Try PATCH first
      const resp = await fetch(`https://pillnow-database.onrender.com/api/medication_schedules/${medication._id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ status: 'Done', alertSent: true }) // Use 'Done' to match backend/AlarmModal
      });
      
      if (!resp.ok) {
        const errorText = await resp.text();
        console.warn(`[Adherence] PATCH failed (${resp.status}): ${errorText}, trying PUT...`);
        
        // Fallback to PUT if PATCH doesn't work
        const putResp = await fetch(`https://pillnow-database.onrender.com/api/medication_schedules/${medication._id}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ ...medication, status: 'Done', alertSent: true })
        });
        
        if (!putResp.ok) {
          const putErrorText = await putResp.text();
          console.error(`[Adherence] ⚠️ PUT also failed (${putResp.status}): ${putErrorText}`);
          throw new Error(`Update failed: ${putErrorText}`);
        } else {
          console.log(`[Adherence] ✅ Schedule ${medication._id} marked as Done (via PUT)`);
        }
      } else {
        console.log(`[Adherence] ✅ Schedule ${medication._id} marked as Done (via PATCH)`);
      }
      setMedications(prev => prev.map(m => m._id === medication._id ? { ...m, status: 'Taken' } : m));
      setModalVisible(false);
      Alert.alert('Updated', 'Marked as Taken');
    } catch (e) {
      Alert.alert('Error', 'Failed to update status');
    }
  };

  const handleGenerateReport = () => {
    const filtered = getFilteredMedications();
    router.push({
      pathname: '/Generate',
      params: { adherenceData: JSON.stringify(filtered) }
    });
  };

  const renderMedicationCard = ({ item }: { item: MedicationRow }) => (
    <TouchableOpacity 
      style={[styles.card, { backgroundColor: theme.card }]}
      onPress={() => {
        setSelectedMedication(item);
        setModalVisible(true);
      }}
    >
      <View style={styles.cardHeader}>
        <Text style={[styles.containerText, { color: theme.primary }]}>Container {item.containerId}</Text>
        <Ionicons 
          name={item.status === 'Taken' ? 'checkmark-circle' : item.status === 'Missed' ? 'close-circle' : 'time'} 
          size={24} 
          color={item.status === 'Taken' ? theme.success : item.status === 'Missed' ? theme.error : theme.warning} 
        />
      </View>
      <Text style={[styles.medicineName, { color: theme.text }]}>{item.medicineName}</Text>
      <View style={styles.detailsContainer}>
        <View style={styles.detailRow}>
          <Ionicons name="time-outline" size={16} color={theme.textSecondary} />
          <Text style={[styles.detailText, { color: theme.textSecondary }]}>{item.scheduledTime}</Text>
        </View>
        <View style={styles.detailRow}>
          <Ionicons name="calendar-outline" size={16} color={theme.textSecondary} />
          <Text style={[styles.detailText, { color: theme.textSecondary }]}>{item.date}</Text>
        </View>
        <View style={styles.detailRow}>
          <Ionicons name="information-circle-outline" size={16} color={theme.textSecondary} />
          <Text style={[styles.detailText, { color: theme.textSecondary }]}>Status: {item.status}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { backgroundColor: theme.card }]}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={theme.text} />
        </TouchableOpacity>
        <View style={styles.headerContent}>
          {isCaregiver && monitoringElder ? (
            <>
              <Text style={[styles.title, { color: theme.secondary }]}>
                ELDER <Text style={[styles.elderNameHighlight, { color: theme.primary }]}>{monitoringElder.name.toUpperCase()}</Text> ADHERENCE
              </Text>
              <View style={[styles.monitoringBanner, { backgroundColor: theme.primary + '20', borderColor: theme.primary }]}>
                <Ionicons name="eye" size={16} color={theme.primary} />
                <Text style={[styles.monitoringText, { color: theme.primary }]}>
                  Monitoring Active
                </Text>
              </View>
            </>
          ) : (
            <Text style={[styles.title, { color: theme.secondary }]}>
              MEDICATION <Text style={[styles.highlight, { color: theme.primary }]}>ADHERENCE</Text>
            </Text>
          )}
        </View>
      </View>

      <View style={styles.contentContainer}>
        {loading ? (
          <View style={{ padding: 20 }}>
            <ActivityIndicator size="large" color={theme.primary} />
            <Text style={{ color: theme.text, marginTop: 8 }}>Loading adherence...</Text>
          </View>
        ) : (
          <FlatList
            data={medications}
            renderItem={renderMedicationCard}
            keyExtractor={(item) => item._id}
            contentContainerStyle={styles.listContainer}
            showsVerticalScrollIndicator={false}
          />
        )}
      </View>

      <View style={[styles.bottomContainer, { backgroundColor: theme.card, borderTopColor: theme.border }]}>
        <View style={styles.filterRow}>
          <Text style={[styles.filterLabel, { color: theme.text }]}>Range:</Text>
          <TouchableOpacity 
            style={[
              styles.filterChip, 
              { backgroundColor: filterMode === '7d' ? theme.primary : theme.background, borderColor: theme.primary }
            ]}
            onPress={() => setFilterMode('7d')}
          >
            <Text style={[styles.filterChipText, { color: filterMode === '7d' ? theme.card : theme.primary }]}>Last 7 days</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[
              styles.filterChip, 
              { backgroundColor: filterMode === 'all' ? theme.primary : theme.background, borderColor: theme.primary }
            ]}
            onPress={() => setFilterMode('all')}
          >
            <Text style={[styles.filterChipText, { color: filterMode === 'all' ? theme.card : theme.primary }]}>All</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[
              styles.filterChip, 
              { backgroundColor: filterMode === 'custom' ? theme.primary : theme.background, borderColor: theme.primary }
            ]}
            onPress={() => setFilterMode('custom')}
          >
            <Text style={[styles.filterChipText, { color: filterMode === 'custom' ? theme.card : theme.primary }]}>Custom</Text>
          </TouchableOpacity>
        </View>

        {filterMode === 'custom' && (
          <View style={styles.customRangeRow}>
            <TouchableOpacity 
              style={[styles.dateButton, { borderColor: theme.primary }]}
              onPress={() => setShowStartPicker(true)}
            >
              <Ionicons name="calendar-outline" size={16} color={theme.primary} />
              <Text style={[styles.dateButtonText, { color: theme.text }]}>{customStart.toLocaleDateString()}</Text>
            </TouchableOpacity>
            <Text style={[styles.toText, { color: theme.textSecondary }]}>to</Text>
            <TouchableOpacity 
              style={[styles.dateButton, { borderColor: theme.primary }]}
              onPress={() => setShowEndPicker(true)}
            >
              <Ionicons name="calendar-outline" size={16} color={theme.primary} />
              <Text style={[styles.dateButtonText, { color: theme.text }]}>{customEnd.toLocaleDateString()}</Text>
            </TouchableOpacity>
          </View>
        )}

        <TouchableOpacity 
          style={[styles.generateButton, { backgroundColor: theme.primary }]}
          onPress={handleGenerateReport}
        >
          <Ionicons name="document-text-outline" size={20} color={theme.card} />
          <Text style={[styles.generateButtonText, { color: theme.card }]}>Generate Report</Text>
        </TouchableOpacity>
      </View>

      {showStartPicker && (
        <DateTimePicker
          value={customStart}
          mode="date"
          display="default"
          onChange={(event, selected) => {
            setShowStartPicker(false);
            if (event?.type === 'dismissed' || !selected) return;
            setCustomStart(selected);
            if (selected > customEnd) setCustomEnd(selected);
          }}
          maximumDate={customEnd}
        />
      )}
      {showEndPicker && (
        <DateTimePicker
          value={customEnd}
          mode="date"
          display="default"
          onChange={(event, selected) => {
            setShowEndPicker(false);
            if (event?.type === 'dismissed' || !selected) return;
            setCustomEnd(selected);
            if (selected < customStart) setCustomStart(selected);
          }}
          minimumDate={customStart}
        />
      )}

      <Modal
        visible={modalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.card }]}>
            {selectedMedication && (
              <>
                <View style={styles.modalHeader}>
                  <Text style={[styles.modalTitle, { color: theme.secondary }]}>Medication Details</Text>
                  <TouchableOpacity onPress={() => setModalVisible(false)}>
                    <Ionicons name="close" size={24} color={theme.textSecondary} />
                  </TouchableOpacity>
                </View>
                <View style={styles.modalBody}>
                  <Text style={[styles.modalText, { color: theme.text }]}>Container: {selectedMedication.containerId}</Text>
                  <Text style={[styles.modalText, { color: theme.text }]}>Medicine: {selectedMedication.medicineName}</Text>
                  <Text style={[styles.modalText, { color: theme.text }]}>Scheduled Time: {selectedMedication.scheduledTime}</Text>
                  <Text style={[styles.modalText, { color: theme.text }]}>Date: {selectedMedication.date}</Text>
                  <Text style={[styles.modalText, { color: theme.text }]}>Status: {selectedMedication.status}</Text>
                </View>
                {selectedMedication.status !== 'Taken' && (
                  <TouchableOpacity 
                    style={[styles.markButton, { backgroundColor: theme.success }]}
                    onPress={() => handleMarkAsTaken(selectedMedication)}
                  >
                    <Text style={[styles.markButtonText, { color: theme.card }]}>Mark as Taken</Text>
                  </TouchableOpacity>
                )}
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    position: 'absolute',
    top: 50,
    left: 15,
    right: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    padding: 12,
    borderRadius: 12,
    elevation: 4,
    zIndex: 1,
  },
  backButton: {
    padding: 8,
  },
  headerContent: {
    flex: 1,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    marginLeft: 8,
  },
  highlight: {
    color: '#4A90E2',
  },
  elderNameHighlight: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  monitoringBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
    gap: 6,
  },
  monitoringText: {
    fontSize: 12,
    fontWeight: '600',
  },
  contentContainer: {
    flex: 1,
    marginTop: 100,
  },
  listContainer: {
    padding: 15,
    paddingBottom: 80,
  },
  card: {
    borderRadius: 12,
    padding: 15,
    marginBottom: 12,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  containerText: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  medicineName: {
    fontSize: 16,
    marginBottom: 10,
  },
  detailsContainer: {
    gap: 8,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  detailText: {
    fontSize: 14,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    borderRadius: 15,
    padding: 20,
    width: '90%',
    maxWidth: 400,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  modalBody: {
    gap: 10,
  },
  modalText: {
    fontSize: 16,
  },
  markButton: {
    padding: 15,
    borderRadius: 10,
    marginTop: 20,
    alignItems: 'center',
  },
  markButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  bottomContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 15,
    borderTopWidth: 1,
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
    flexWrap: 'wrap',
  },
  filterLabel: {
    fontWeight: '600',
  },
  filterChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  customRangeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  dateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  dateButtonText: {
    fontSize: 13,
  },
  toText: {
    fontSize: 13,
  },
  generateButton: {
    flexDirection: 'row',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  generateButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
  },
});

export default Adherence;
