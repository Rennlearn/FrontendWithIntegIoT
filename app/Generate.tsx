import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, Modal, ActivityIndicator } from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';
import verificationService from '@/services/verificationService';

interface MedicationRow {
  _id: string;
  containerId: number;
  medicineName: string;
  scheduledTime: string;
  date: string;
  status: 'Taken' | 'Pending' | 'Missed';
  imageBase64?: string; // Base64 encoded image for PDF
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

  // Fetch latest capture image for a container and convert to base64
  const fetchContainerImage = async (containerId: number): Promise<string | null> => {
    try {
      const base = await verificationService.getBackendUrl();
      const containerIdStr = `container${containerId}`;
      const response = await fetch(`${base}/captures/latest/${containerIdStr}?t=${Date.now()}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
        },
      });

      if (response.ok) {
        const data = await response.json();
        const imagePath = data.latest?.annotated || data.latest?.raw;
        
        if (imagePath) {
          // Construct full URL
          const fullUrl = imagePath.startsWith('http') 
            ? imagePath 
            : `${base}${imagePath}`;
          
          // Download image using expo-file-system and convert to base64
          try {
            // Download the image to a temporary file
            const fileUri = `${FileSystem.cacheDirectory}container_${containerId}_${Date.now()}.jpg`;
            const downloadResult = await FileSystem.downloadAsync(fullUrl, fileUri);
            
            if (downloadResult.status === 200) {
              // Read the file as base64
              const base64String = await FileSystem.readAsStringAsync(downloadResult.uri, {
                encoding: FileSystem.EncodingType.Base64,
              });
              
              // Clean up temporary file
              try {
                await FileSystem.deleteAsync(downloadResult.uri, { idempotent: true });
              } catch (cleanupError) {
                // Ignore cleanup errors
              }
              
              // Return data URL format for HTML img src
              return `data:image/jpeg;base64,${base64String}`;
            }
          } catch (downloadError) {
            console.warn(`[Generate] Failed to download image for container ${containerId}:`, downloadError);
          }
        }
      }
    } catch (error) {
      console.warn(`[Generate] Failed to fetch image for container ${containerId}:`, error);
    }
    return null;
  };

  const generatePDF = async () => {
    setGenerating(true);
    try {
      const data: MedicationRow[] = JSON.parse(adherenceDataParam || '[]');
      
      // Fetch images for each unique container
      const uniqueContainers = [...new Set(data.map(d => d.containerId))];
      const containerImages: Record<number, string | null> = {};
      
      console.log(`[Generate] Fetching images for ${uniqueContainers.length} containers...`);
      for (const containerId of uniqueContainers) {
        const imageBase64 = await fetchContainerImage(containerId);
        containerImages[containerId] = imageBase64;
        console.log(`[Generate] ${imageBase64 ? '✅' : '❌'} Container ${containerId} image ${imageBase64 ? 'loaded' : 'not available'}`);
      }
      
      // Add images to data rows
      const dataWithImages = data.map(med => ({
        ...med,
        imageBase64: containerImages[med.containerId] || null,
      }));
      
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
                margin: 0;
              }
              h1 {
                color: #D14A99;
                text-align: center;
                margin-bottom: 10px;
              }
              .generated-date {
                text-align: center;
                color: #666;
                margin-bottom: 20px;
                font-size: 14px;
              }
              .summary {
                margin: 20px 0;
                padding: 16px;
                border: 1px solid #ddd;
                border-radius: 8px;
                background-color: #f9f9f9;
                display: flex;
                justify-content: space-around;
                flex-wrap: wrap;
              }
              .summary-item {
                text-align: center;
                margin: 8px;
              }
              .summary-label {
                font-size: 12px;
                color: #666;
                margin-bottom: 4px;
              }
              .summary-value {
                font-size: 18px;
                font-weight: bold;
                color: #333;
              }
              table {
                width: 100%;
                border-collapse: collapse;
                margin-top: 20px;
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                background-color: #fff;
              }
              thead {
                background-color: #4A90E2;
                color: white;
              }
              th {
                padding: 12px 8px;
                text-align: left;
                font-weight: bold;
                border-bottom: 2px solid #357ABD;
                font-size: 14px;
              }
              td {
                padding: 10px 8px;
                border-bottom: 1px solid #e0e0e0;
                font-size: 13px;
                vertical-align: middle;
              }
              tbody tr:hover {
                background-color: #f5f5f5;
              }
              tbody tr:last-child td {
                border-bottom: none;
              }
              .image-cell {
                text-align: center;
                width: 120px;
              }
              .container-image {
                max-width: 100px;
                max-height: 100px;
                object-fit: contain;
                border: 1px solid #ddd;
                border-radius: 4px;
                padding: 4px;
                background-color: #f9f9f9;
              }
              .no-image {
                color: #999;
                font-size: 11px;
                font-style: italic;
              }
              .status-taken {
                color: #4CAF50;
                font-weight: bold;
              }
              .status-pending {
                color: #FFA500;
                font-weight: bold;
              }
              .status-missed {
                color: #E53935;
                font-weight: bold;
              }
              .container-cell {
                font-weight: 600;
                color: #4A90E2;
              }
              @media print {
                body {
                  padding: 10px;
                }
                table {
                  page-break-inside: auto;
                }
                tr {
                  page-break-inside: avoid;
                  page-break-after: auto;
                }
              }
            </style>
          </head>
          <body>
            <h1>Medication Adherence Report</h1>
            <p class="generated-date">Generated on: ${new Date().toLocaleString()}</p>
            
            <div class="summary">
              <div class="summary-item">
                <div class="summary-label">Total Doses</div>
                <div class="summary-value">${total}</div>
              </div>
              <div class="summary-item">
                <div class="summary-label">Taken</div>
                <div class="summary-value" style="color: #4CAF50;">${taken} (${adherencePct}%)</div>
              </div>
              <div class="summary-item">
                <div class="summary-label">Missed</div>
                <div class="summary-value" style="color: #E53935;">${missed}</div>
              </div>
              <div class="summary-item">
                <div class="summary-label">Pending</div>
                <div class="summary-value" style="color: #FFA500;">${pending}</div>
              </div>
            </div>

            <table>
              <thead>
                <tr>
                  <th>Container</th>
                  <th>Image</th>
                  <th>Medicine Name</th>
                  <th>Date</th>
                  <th>Scheduled Time</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                ${dataWithImages.map(med => `
                  <tr>
                    <td class="container-cell">Container ${med.containerId}</td>
                    <td class="image-cell">
                      ${med.imageBase64 
                        ? `<img src="${med.imageBase64}" alt="Container ${med.containerId} capture" class="container-image" />` 
                        : `<span class="no-image">No image available</span>`
                      }
                    </td>
                    <td>${med.medicineName || 'N/A'}</td>
                    <td>${med.date || 'N/A'}</td>
                    <td>${med.scheduledTime || 'N/A'}</td>
                    <td class="${med.status === 'Taken' ? 'status-taken' : med.status === 'Missed' ? 'status-missed' : 'status-pending'}">
                      ${med.status}
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
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
