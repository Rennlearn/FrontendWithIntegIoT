import React, { useEffect, useState } from 'react';
import { 
  View, Text, StyleSheet, ScrollView, TouchableOpacity, 
  Modal, FlatList, ActivityIndicator, Alert
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTheme } from './context/ThemeContext';
import { lightTheme, darkTheme } from './styles/theme';
import AsyncStorage from '@react-native-async-storage/async-storage';

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

  const fetchAdherenceData = async () => {
    try {
      setLoading(true);
      const schedulesResp = await fetch('https://pillnow-database.onrender.com/api/medication_schedules', {
        headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache', 'If-Modified-Since': '0' }
      });
      const schedulesJson = await schedulesResp.json();
      const schedules: any[] = schedulesJson?.data || [];

      const medsResp = await fetch('https://pillnow-database.onrender.com/api/medications');
      const medsJson = await medsResp.json();
      const medsArray: any[] = Array.isArray(medsJson) ? medsJson : (medsJson?.data || []);

      const now = new Date();
      const rows: MedicationRow[] = schedules.map((s) => {
        const med = medsArray.find(m => m.medId === s.medication);
        const [y, m, d] = String(s.date).split('-').map(Number);
        const [hh, mm] = String(s.time).split(':').map(Number);
        const when = new Date(y, (m || 1) - 1, d, hh, mm);
        let status: 'Taken' | 'Pending' | 'Missed' = s.status === 'Taken' ? 'Taken' : 'Pending';
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
    } catch (e) {
      Alert.alert('Error', 'Failed to load adherence data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAdherenceData();
  }, []);

  const handleMarkAsTaken = async (medication: MedicationRow) => {
    try {
      const resp = await fetch(`https://pillnow-database.onrender.com/api/medication_schedules/${medication._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'Taken', alertSent: true })
      });
      if (!resp.ok) {
        const putResp = await fetch(`https://pillnow-database.onrender.com/api/medication_schedules/${medication._id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'Taken', alertSent: true })
        });
        if (!putResp.ok) throw new Error('Update failed');
      }
      setMedications(prev => prev.map(m => m._id === medication._id ? { ...m, status: 'Taken' } : m));
      setModalVisible(false);
      Alert.alert('Updated', 'Marked as Taken');
    } catch (e) {
      Alert.alert('Error', 'Failed to update status');
    }
  };

  const handleGenerateReport = () => {
    router.push({
      pathname: '/Generate',
      params: { adherenceData: JSON.stringify(medications) }
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
          <Text style={[styles.title, { color: theme.secondary }]}>
            MEDICATION <Text style={[styles.highlight, { color: theme.primary }]}>ADHERENCE</Text>
          </Text>
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
        <TouchableOpacity 
          style={[styles.generateButton, { backgroundColor: theme.primary }]}
          onPress={handleGenerateReport}
        >
          <Ionicons name="document-text-outline" size={20} color={theme.card} />
          <Text style={[styles.generateButtonText, { color: theme.card }]}>Generate Report</Text>
        </TouchableOpacity>
      </View>

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
