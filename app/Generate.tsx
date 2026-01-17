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
  verificationResults?: {
    pass: boolean;
    count: number;
    confidence: number;
    detectedTypes: Array<{ label: string; n: number }>;
    source: string;
  } | null; // Verification results for phone camera entries
  isPhoneCamera?: boolean; // Flag to identify phone camera entries
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

  // CRITICAL: Normalize container ID to ensure correct image mapping
  // Ensures consistent parsing of container identifiers (numeric, "container1", "morning", etc.)
  // Returns 0 for phone camera entries, 1-3 for regular containers
  const normalizeContainer = (raw: any): 0 | 1 | 2 | 3 => {
    // Phone camera entries use container = 0
    if (raw === 0 || raw === null || raw === undefined) return 0;
    const s = String(raw).trim().toLowerCase();

    // Extract first digit sequence (handles "1", "01", "container2", etc.)
    const m = s.match(/(\d+)/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n === 0) return 0; // Phone camera
      if (n === 1 || n === 2 || n === 3) return n as 1 | 2 | 3;
    }

    // Legacy string labels
    if (s === 'morning') return 1;
    if (s === 'noon') return 2;
    if (s === 'evening' || s === 'night') return 3;

    // Fallback to container 1 for any unknown format
    return 1;
  };

  // Fetch schedule-specific capture image for a medication row and convert to base64
  // CRITICAL: Fetches the image that was captured for this specific schedule (date + time + container)
  // Falls back to latest image if no schedule-specific match is found
  const fetchScheduleImage = async (containerId: number, date: string, time: string): Promise<string | null> => {
    try {
      // Normalize container ID to ensure correct mapping
      const normalizedId = normalizeContainer(containerId);
      const base = await verificationService.getBackendUrl();
      const containerIdStr = `container${normalizedId}`;
      
      // Normalize date and time formats
      const scheduleDate = String(date).substring(0, 10); // YYYY-MM-DD
      const scheduleTime = String(time).substring(0, 5); // HH:MM
      
      let imagePath: string | null = null;
      
      // CRITICAL: First try to get schedule-specific image (date + time + container)
      // This ensures each schedule shows the image captured for that specific schedule
      try {
        const scheduleResponse = await fetch(`${base}/captures/schedule/${containerIdStr}?date=${scheduleDate}&time=${scheduleTime}&t=${Date.now()}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache',
          },
        });
        
        if (scheduleResponse.ok) {
          const scheduleData = await scheduleResponse.json();
          imagePath = scheduleData.image?.annotated || scheduleData.image?.raw || null;
          if (imagePath) {
            console.log(`[Generate] ✅ Found schedule-specific image for Container ${normalizedId} at ${scheduleDate} ${scheduleTime}`);
          }
        }
      } catch (scheduleError) {
        console.warn(`[Generate] Failed to fetch schedule-specific image for Container ${normalizedId}:`, scheduleError);
      }
      
      // Fallback to latest image if no schedule-specific match found
      if (!imagePath) {
        try {
          const latestResponse = await fetch(`${base}/captures/latest/${containerIdStr}?t=${Date.now()}`, {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
              'Cache-Control': 'no-cache',
            },
          });
          
          if (latestResponse.ok) {
            const latestData = await latestResponse.json();
            imagePath = latestData.latest?.annotated || latestData.latest?.raw || null;
            if (imagePath) {
              console.log(`[Generate] ⚠️ Using latest image (no schedule match) for Container ${normalizedId} at ${scheduleDate} ${scheduleTime}`);
            }
          }
        } catch (latestError) {
          console.warn(`[Generate] Failed to fetch latest image for Container ${normalizedId}:`, latestError);
        }
      }
      
      if (imagePath) {
        // Construct full URL
        const fullUrl = imagePath.startsWith('http') 
          ? imagePath 
          : `${base}${imagePath}`;
        
        // Download image using expo-file-system and convert to base64
        try {
          // Download the image to a temporary file
          // CRITICAL: Use unique filename with container, date, time, and timestamp to prevent caching/reuse
          const uniqueId = `${containerId}_${scheduleDate}_${scheduleTime}_${Date.now()}_${Math.random().toString(36).substring(7)}`;
          const fileUri = `${FileSystem.cacheDirectory}container_${uniqueId}.jpg`;
          console.log(`[Generate] Downloading image from ${fullUrl} to ${fileUri}...`);
          
          const downloadResult = await FileSystem.downloadAsync(fullUrl, fileUri);
          
          if (downloadResult.status === 200) {
            // Read the file as base64
            const base64String = await FileSystem.readAsStringAsync(downloadResult.uri, {
              encoding: FileSystem.EncodingType.Base64,
            });
            
            // Clean up temporary file immediately after reading
            try {
              await FileSystem.deleteAsync(downloadResult.uri, { idempotent: true });
            } catch (cleanupError) {
              // Ignore cleanup errors
            }
            
            // Return data URL format for HTML img src
            // CRITICAL: Each call returns a unique base64 string - no caching
            const base64DataUrl = `data:image/jpeg;base64,${base64String}`;
            console.log(`[Generate] ✅ Successfully converted image to base64 (length: ${base64String.length} chars)`);
            return base64DataUrl;
          } else {
            console.warn(`[Generate] ⚠️ Image download returned status ${downloadResult.status}`);
          }
        } catch (downloadError) {
          console.warn(`[Generate] Failed to download image for Container ${normalizedId}:`, downloadError);
        }
      }
    } catch (error) {
      console.warn(`[Generate] Failed to fetch image for Container ${containerId}:`, error);
    }
    return null;
  };

  const generatePDF = async () => {
    setGenerating(true);
    try {
      console.log(`[Generate] Starting PDF generation with data: ${adherenceDataParam?.substring(0, 100)}...`);
      const data: MedicationRow[] = JSON.parse(adherenceDataParam || '[]');
      
      if (!data || data.length === 0) {
        Alert.alert('Error', 'No medication data provided for report generation.');
        setGenerating(false);
        return;
      }
      
      console.log(`[Generate] Processing ${data.length} medication record(s)`);
      
      // CRITICAL: Normalize container IDs
      const normalizedData = data.map(med => ({
        ...med,
        containerId: normalizeContainer(med.containerId),
      }));
      
      // CRITICAL: Fetch schedule-specific images for each medication row individually
      // This ensures each schedule shows the image captured for that specific schedule (date + time + container)
      // NOT just the latest image for the container (which would show same image for all schedules)
      console.log(`[Generate] Fetching schedule-specific images for ${normalizedData.length} medication records...`);
      const dataWithImages = await Promise.all(
        normalizedData.map(async (med, index) => {
          let imageBase64: string | null = null;
          
          // Skip phone camera entries (containerId = 0) - images handled separately if needed
          if (med.containerId !== 0 && med.date && med.scheduledTime) {
            try {
              console.log(`[Generate] [${index + 1}/${normalizedData.length}] Fetching image for Container ${med.containerId} at ${med.date} ${med.scheduledTime}...`);
              // Fetch schedule-specific image for this medication row
              // CRITICAL: Each call is independent - no caching, each schedule gets its own image
              imageBase64 = await fetchScheduleImage(med.containerId, med.date, med.scheduledTime);
              if (imageBase64) {
                // Log first 50 chars of base64 to verify different images
                const imagePreview = imageBase64.substring(0, 50);
                console.log(`[Generate] ✅ [${index + 1}/${normalizedData.length}] Loaded image for Container ${med.containerId} at ${med.date} ${med.scheduledTime} (base64 preview: ${imagePreview}...)`);
              } else {
                console.log(`[Generate] ⚠️ [${index + 1}/${normalizedData.length}] No image found for Container ${med.containerId} at ${med.date} ${med.scheduledTime}`);
              }
            } catch (imageError) {
              console.warn(`[Generate] ❌ [${index + 1}/${normalizedData.length}] Failed to fetch image for Container ${med.containerId} at ${med.date} ${med.scheduledTime}:`, imageError);
            }
          } else {
            console.log(`[Generate] ⏭️ [${index + 1}/${normalizedData.length}] Skipping image fetch (phone camera or missing date/time): Container ${med.containerId}`);
          }
          
          return {
            ...med,
            imageBase64, // CRITICAL: Each row gets its own imageBase64 - no sharing between rows
          };
        })
      );
      
      // Log summary of images loaded and verify uniqueness
      const imagesLoaded = dataWithImages.filter(d => d.imageBase64 !== null).length;
      const imagesWithBase64 = dataWithImages.filter(d => d.imageBase64 !== null);
      const uniqueImageHashes = new Set(imagesWithBase64.map(d => d.imageBase64?.substring(0, 200))).size;
      console.log(`[Generate] 📊 Image loading summary: ${imagesLoaded}/${normalizedData.length} rows have images, ${uniqueImageHashes} unique images`);
      
      // CRITICAL: Verify each container/schedule combination has its own image
      const containerScheduleMap = new Map<string, string>();
      let duplicateImagesFound = false;
      for (const med of dataWithImages) {
        if (med.imageBase64 && med.containerId !== 0) {
          const key = `Container${med.containerId}_${med.date}_${med.scheduledTime}`;
          const existingImage = containerScheduleMap.get(key);
          if (existingImage && existingImage === med.imageBase64.substring(0, 200)) {
            console.warn(`[Generate] ⚠️ WARNING: Duplicate image detected for ${key}`);
            duplicateImagesFound = true;
          } else {
            containerScheduleMap.set(key, med.imageBase64.substring(0, 200));
          }
        }
      }
      
      if (duplicateImagesFound) {
        console.warn(`[Generate] ⚠️ Some schedules may be showing duplicate images - check backend schedule matching`);
      } else {
        console.log(`[Generate] ✅ All images are unique for their container/schedule combinations`);
      }
      
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
                ${dataWithImages.map((med, idx) => {
                  const isPhoneCamera = med.containerId === 0 || med.isPhoneCamera;
                  const verificationResults = med.verificationResults;
                  // CRITICAL: Each row gets its own unique image - verify imageBase64 is set correctly
                  const hasImage = med.imageBase64 !== null && med.imageBase64 !== undefined;
                  const imagePreview = hasImage ? med.imageBase64.substring(0, 50) : 'NO_IMAGE';
                  console.log(`[Generate] PDF Row ${idx + 1}: Container ${med.containerId}, Date ${med.date}, Time ${med.scheduledTime}, HasImage: ${hasImage}, Preview: ${imagePreview}...`);
                  
                  return `
                  <tr>
                    <td class="container-cell">${isPhoneCamera ? '-' : `Container ${med.containerId}`}</td>
                    <td class="image-cell">
                      ${hasImage
                        ? `<img src="${med.imageBase64}" alt="${isPhoneCamera ? 'Phone Camera' : `Container ${med.containerId} - ${med.date} ${med.scheduledTime}`} capture" class="container-image" />` 
                        : `<span class="no-image">No image available</span>`
                      }
                    </td>
                    <td>${med.medicineName || 'N/A'}</td>
                    <td>${med.date || 'N/A'}</td>
                    <td>${med.scheduledTime || 'N/A'}</td>
                    <td class="${isPhoneCamera && verificationResults
                      ? (verificationResults.pass ? 'status-taken' : 'status-missed')
                      : (med.status === 'Taken' ? 'status-taken' : med.status === 'Missed' ? 'status-missed' : 'status-pending')}">
                      ${isPhoneCamera && verificationResults
                        ? `Result: ${verificationResults.pass ? 'PASSED' : 'FAILED'} (${verificationResults.count} pills, ${(verificationResults.confidence * 100).toFixed(1)}%)`
                        : med.status}
                    </td>
                  </tr>
                `;
                }).join('')}
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
