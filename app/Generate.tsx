import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, Modal, ActivityIndicator } from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';

interface MedicationRow {
  _id: string;
  containerId: number;
  medicineName: string;
  scheduledTime: string;
  date: string;
  status: 'Taken' | 'Pending' | 'Missed';
}

const Generate = () => {
  const route = useRoute();
  const navigation = useNavigation();
  // Be defensive: params may be undefined depending on navigator
  const params = (route?.params as any) || {};
  const adherenceDataParam: string = typeof params.adherenceData === 'string' ? params.adherenceData : '[]';

  const [showNameModal, setShowNameModal] = useState(true);
  const [pdfFileName, setPdfFileName] = useState('');
  const [generating, setGenerating] = useState(false);

  // Generate default filename with date
  useEffect(() => {
    const defaultName = `Medication_Adherence_Report_${new Date().toISOString().split('T')[0].replace(/-/g, '_')}`;
    setPdfFileName(defaultName);
  }, []);

  const handleGenerate = () => {
    if (!pdfFileName.trim()) {
      Alert.alert('Error', 'Please enter a filename for the PDF.');
      return;
    }
    setShowNameModal(false);
    generatePDF();
  };

  const generatePDF = async () => {
    setGenerating(true);
    try {
      const data: MedicationRow[] = JSON.parse(adherenceDataParam || '[]');
      const total = data.length;
      const taken = data.filter(d => d.status === 'Taken').length;
      const missed = data.filter(d => d.status === 'Missed').length;
      const pending = total - taken - missed;
      const adherencePct = total > 0 ? Math.round((taken / total) * 100) : 0;

      const html = `
        <html>
          <head>
            <style>
              body {
                font-family: Arial, sans-serif;
                padding: 20px;
              }
              h1 {
                color: #D14A99;
                text-align: center;
              }
              .summary { margin: 16px 0; padding: 12px; border: 1px solid #ddd; border-radius: 8px; }
              .container {
                margin-bottom: 20px;
                padding: 15px;
                border: 1px solid #ddd;
                border-radius: 5px;
              }
              .header {
                color: #4A90E2;
                font-weight: bold;
              }
              .status {
                color: #4CAF50;
              }
              .pending {
                color: #FFA500;
              }
              .missed {
                color: #E53935;
              }
            </style>
          </head>
          <body>
            <h1>Medication Adherence Report</h1>
            <p>Generated on: ${new Date().toLocaleString()}</p>
            <div class="summary">
              <p><strong>Total doses:</strong> ${total}</p>
              <p><strong>Taken:</strong> ${taken} (${adherencePct}%)</p>
              <p><strong>Missed:</strong> ${missed}</p>
              <p><strong>Pending:</strong> ${pending}</p>
            </div>
            ${data.map(med => `
              <div class="container">
                <h2 class="header">Container ${med.containerId}</h2>
                <p><strong>Medicine:</strong> ${med.medicineName}</p>
                <p><strong>Scheduled Time:</strong> ${med.scheduledTime}</p>
                <p><strong>Date:</strong> ${med.date}</p>
                <p><strong>Status:</strong> 
                  <span class="${med.status === 'Taken' ? 'status' : med.status === 'Missed' ? 'missed' : 'pending'}">
                    ${med.status}
                  </span>
                </p>
              </div>
            `).join('')}
          </body>
        </html>
      `;

      // Generate PDF with default name
      const { uri } = await Print.printToFileAsync({ html });
      
      // Rename the file with custom name
      const sanitizedFileName = pdfFileName.trim().replace(/[^a-z0-9_-]/gi, '_');
      const newFileName = sanitizedFileName.endsWith('.pdf') 
        ? sanitizedFileName 
        : `${sanitizedFileName}.pdf`;
      
      // Get directory from original URI
      const directory = uri.substring(0, uri.lastIndexOf('/') + 1);
      const newUri = `${directory}${newFileName}`;
      
      let finalUri = uri;
      
      try {
        // Move/rename the file
        await FileSystem.moveAsync({
          from: uri,
          to: newUri,
        });
        finalUri = newUri;
      } catch (renameError) {
        console.warn('Failed to rename PDF file:', renameError);
        // Continue with original filename if rename fails
      }

      // Share the file (with custom name if renamed, otherwise default name)
      await Sharing.shareAsync(finalUri, {
        mimeType: 'application/pdf',
        dialogTitle: `Share ${newFileName}`,
      });

      navigation.goBack();
    } catch (error) {
      console.error('PDF generation error:', error);
      Alert.alert('Error', 'Failed to generate PDF report. Please try again.');
      navigation.goBack();
    } finally {
      setGenerating(false);
    }
  };

  return (
    <View style={styles.container}>
      {generating ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#4A90E2" />
          <Text style={styles.text}>Generating PDF report...</Text>
        </View>
      ) : (
        <Modal
          visible={showNameModal}
          transparent={true}
          animationType="slide"
          onRequestClose={() => {
            setShowNameModal(false);
            navigation.goBack();
          }}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Name Your PDF Report</Text>
              <Text style={styles.modalSubtitle}>
                Enter a name for the PDF file (without .pdf extension)
              </Text>
              <TextInput
                style={styles.input}
                value={pdfFileName}
                onChangeText={setPdfFileName}
                placeholder="Enter filename"
                placeholderTextColor="#999"
                autoFocus={true}
                autoCapitalize="words"
              />
              <View style={styles.buttonContainer}>
                <TouchableOpacity
                  style={[styles.button, styles.cancelButton]}
                  onPress={() => {
                    setShowNameModal(false);
                    navigation.goBack();
                  }}
                >
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.button, styles.generateButton]}
                  onPress={handleGenerate}
                >
                  <Text style={styles.generateButtonText}>Generate PDF</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
  },
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    fontSize: 18,
    color: '#666666',
    marginTop: 20,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderRadius: 15,
    padding: 24,
    width: '85%',
    maxWidth: 400,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 8,
    textAlign: 'center',
  },
  modalSubtitle: {
    fontSize: 14,
    color: '#666',
    marginBottom: 20,
    textAlign: 'center',
  },
  input: {
    borderWidth: 1,
    borderColor: '#DDD',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    backgroundColor: '#F9F9F9',
    marginBottom: 20,
  },
  buttonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  button: {
    flex: 1,
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  cancelButton: {
    backgroundColor: '#E0E0E0',
  },
  generateButton: {
    backgroundColor: '#4A90E2',
  },
  cancelButtonText: {
    color: '#333',
    fontSize: 16,
    fontWeight: '600',
  },
  generateButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});

export default Generate;
