import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  Alert,
  ActivityIndicator,
  ScrollView,
  Modal,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '@/context/ThemeContext';
import { lightTheme, darkTheme } from '@/styles/theme';
import verificationService from '@/services/verificationService';

interface VerificationResult {
  success: boolean;
  pass_: boolean;
  count: number;
  classesDetected: Array<{ label: string; n: number }>;
  confidence: number;
  message?: string;
  annotatedImageUrl?: string;
  annotatedImage?: string; // Base64 encoded annotated image
}

/**
 * PillDetectionCamera Component
 * 
 * CRITICAL: This component is COMPLETELY STANDALONE
 * - Detects what pills are in the photo (camera or gallery)
 * - Counts how many pills are detected
 * - Shows annotated image with detection results
 * - Does NOT connect to containers
 * - Does NOT fetch scheduling data
 * - Does NOT trigger mismatch modals
 * - Does NOT trigger buzzer
 * - Does NOT associate with container logic
 * - Does NOT store in container verification state
 * - Does NOT save any data
 * - Only displays detection results to the user
 * 
 * Phone camera detection is completely separate from ESP32-CAM container detection.
 * ESP32-CAM detection triggers safety alerts (mismatch modal, buzzer).
 * Phone camera detection is purely informational and standalone.
 */
const PillDetectionCamera = () => {
  const router = useRouter();
  const { isDarkMode } = useTheme();
  const theme = isDarkMode ? darkTheme : lightTheme;
  
  const [image, setImage] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [showResultModal, setShowResultModal] = useState(false);

  // Show modal when result is set
  useEffect(() => {
    if (result) {
      console.log('[PillDetectionCamera] Result changed, showing modal. Result:', JSON.stringify(result, null, 2));
      setShowResultModal(true);
    } else {
      setShowResultModal(false);
    }
  }, [result]);

  // Request camera permissions on mount
  useEffect(() => {
    (async () => {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Camera Permission Required',
          'Please grant camera permission to use pill detection.',
          [{ text: 'OK' }]
        );
      }
    })();
  }, []);

  const takePicture = async () => {
    try {
      const { status } = await ImagePicker.getCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Permission Required',
          'Camera permission is required to take photos.',
          [{ text: 'OK' }]
        );
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 1.0, // Maximum quality for better pill detection
        base64: false,
        exif: true, // Preserve EXIF data for better image quality
      });

      if (!result.canceled && result.assets[0]) {
        setImage(result.assets[0].uri);
        setResult(null);
      }
    } catch (error) {
      console.error('[PillDetectionCamera] Error taking picture:', error);
      Alert.alert('Error', 'Failed to take picture. Please try again.');
    }
  };

  const pickFromGallery = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Permission Required',
          'Gallery permission is required to select images.',
          [{ text: 'OK' }]
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 1.0, // Maximum quality for better pill detection
        base64: false,
        exif: true, // Preserve EXIF data for better image quality
      });

      if (!result.canceled && result.assets[0]) {
        setImage(result.assets[0].uri);
        setResult(null);
      }
    } catch (error) {
      console.error('[PillDetectionCamera] Error picking image:', error);
      Alert.alert('Error', 'Failed to pick image. Please try again.');
    }
  };

  const verifyDirectly = async () => {
    if (!image) return;

    try {
      setVerifying(true);
      const base = await verificationService.getBackendUrl();
      
      // CRITICAL: Phone camera detection is completely standalone
      // - No container association
      // - No scheduling data fetching
      // - No container logic
      // - Just pure detection and verification

      // Use standalone backend /ingest/phone endpoint (no container parameter)
      const ingestFormData = new FormData();
      const filename = image.split('/').pop() || 'pill_image.jpg';
      const fileExtension = filename.split('.').pop() || 'jpg';
      const mimeType = fileExtension === 'png' ? 'image/png' : 'image/jpeg';
      
      ingestFormData.append('image', {
        uri: image,
        type: mimeType,
        name: filename,
      } as any);
      // Optional: can include expected pill info in meta for comparison, but not required
      ingestFormData.append('meta', JSON.stringify({}));

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000); // 20 second timeout for backend
      
      try {
        // Use standalone endpoint - no container parameter
        const ingestResponse = await fetch(`${base}/ingest/phone`, {
          method: 'POST',
          body: ingestFormData,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!ingestResponse.ok) {
          const errorText = await ingestResponse.text();
          let errorMsg = `Backend ingest error: ${ingestResponse.status} - ${errorText}`;
          
          // Handle verifier unreachable error (502) - verifier service may be starting
          if (ingestResponse.status === 502 && errorText.includes('Verifier unreachable')) {
            errorMsg = `Verifier service is not running or still loading.\n\nBackend URL: ${base}\n\nPlease ensure:\n1. Verifier service is running (python3 -m uvicorn backend.verifier.main:app --host 0.0.0.0 --port 8000)\n2. Verifier is fully loaded (may take 30-60 seconds to load ML models)\n3. Check verifier logs: backend/verifier_runtime.log`;
          }
          
          throw new Error(errorMsg);
        }

        const ingestData = await ingestResponse.json();
        console.log('[PillDetectionCamera] Backend /ingest response:', JSON.stringify(ingestData, null, 2));
        
        // Backend /ingest returns: { ok: true, result: { ... }, ... }
        // The result contains: pass_, count, classesDetected, confidence, annotatedImagePath, annotatedImage
        const backendResult = ingestData.result || ingestData;
        
        if (backendResult && (backendResult.pass_ !== undefined || backendResult.count !== undefined)) {
          // Construct image URI - prefer base64 if available, otherwise use URL
          let annotatedImageUri: string | undefined;
          if (backendResult.annotatedImage) {
            // Use base64 image directly
            annotatedImageUri = `data:image/jpeg;base64,${backendResult.annotatedImage}`;
          } else if (backendResult.annotatedImagePath) {
            // Fallback to URL path
            annotatedImageUri = backendResult.annotatedImagePath.startsWith('http') 
              ? backendResult.annotatedImagePath 
              : `${base}${backendResult.annotatedImagePath}`;
          }
          
          const resultData: VerificationResult = {
            success: true,
            pass_: backendResult.pass_ || false,
            count: backendResult.count || 0,
            classesDetected: backendResult.classesDetected || [],
            confidence: backendResult.confidence || 0,
            message: 'Verification complete via backend',
            annotatedImageUrl: annotatedImageUri,
            annotatedImage: backendResult.annotatedImage,
          };
          
          console.log('[PillDetectionCamera] Setting result:', JSON.stringify(resultData, null, 2));
          setResult(resultData);
        } else {
          console.error('[PillDetectionCamera] Backend response format unexpected:', JSON.stringify(ingestData, null, 2));
          throw new Error('Backend did not return verification result in expected format');
        }
      } catch (ingestError) {
        clearTimeout(timeoutId);
        
        // Provide more specific error message for backend ingest failure
        if (ingestError instanceof TypeError && ingestError.message.includes('Network request failed')) {
          const backendUrl = base || 'unknown';
          throw new Error(`Cannot connect to backend server at ${backendUrl}.\n\nPlease check:\n1. Backend is running (node backend/server.js)\n2. Device and backend are on same network\n3. Backend URL is correct\n\nCurrent URL: ${backendUrl}\n\nYou can update the backend URL in Monitor & Manage screen.`);
        } else if (ingestError instanceof Error && ingestError.name === 'AbortError') {
          throw new Error(`Backend request timed out after 20 seconds.\n\nBackend URL: ${base}\n\nPlease check:\n1. Backend is running\n2. Network connection is stable\n3. Backend URL is correct`);
        } else {
          const backendUrl = base || 'unknown';
          const errorMsg = ingestError instanceof Error ? ingestError.message : String(ingestError);
          throw new Error(`Backend error: ${errorMsg}\n\nBackend URL: ${backendUrl}`);
        }
      }
    } catch (error) {
      console.error('[PillDetectionCamera] Verification error:', error);
      Alert.alert(
        'Verification Failed',
        error instanceof Error ? error.message : 'An unknown error occurred',
        [{ text: 'OK' }]
      );
    } finally {
      setVerifying(false);
    }
  };

  const reset = () => {
    setImage(null);
    setResult(null);
    setShowResultModal(false);
  };

  return (
    <ScrollView style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <Ionicons name="arrow-back" size={24} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: theme.text }]}>Pill Detection</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.content}>
        <Text style={[styles.description, { color: theme.textSecondary }]}>
          Take a photo or select an image from your gallery to detect what pills are in the image and how many pills there are. This is for verification only and does not save data or trigger alarms.
        </Text>

        {!image ? (
          <View style={styles.buttonContainer}>
            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: theme.primary }]}
              onPress={takePicture}
            >
              <Ionicons name="camera" size={32} color={theme.card} />
              <Text style={[styles.buttonText, { color: theme.card }]}>Take Photo</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: theme.secondary }]}
              onPress={pickFromGallery}
            >
              <Ionicons name="images" size={32} color={theme.card} />
              <Text style={[styles.buttonText, { color: theme.card }]}>Choose from Gallery</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.imageContainer}>
            <Image source={{ uri: image }} style={styles.previewImage} />
            
            <View style={styles.buttonRow}>
              <TouchableOpacity
                style={[styles.smallButton, { backgroundColor: theme.error }]}
                onPress={reset}
              >
                <Ionicons name="close" size={20} color={theme.card} />
                <Text style={[styles.smallButtonText, { color: theme.card }]}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.smallButton, { backgroundColor: theme.primary }]}
                onPress={verifyDirectly}
                disabled={verifying}
              >
                {verifying ? (
                  <ActivityIndicator size="small" color={theme.card} />
                ) : (
                  <>
                    <Ionicons name="checkmark-circle" size={20} color={theme.card} />
                    <Text style={[styles.smallButtonText, { color: theme.card }]}>Verify</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}

        {verifying && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={theme.primary} />
            <Text style={[styles.loadingText, { color: theme.text }]}>
              Analyzing image...
            </Text>
          </View>
        )}
      </View>

      {/* Result Modal */}
      <Modal
        visible={showResultModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShowResultModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.card }]}>
            <ScrollView>
              <View style={styles.modalHeader}>
                <Text style={[styles.modalTitle, { color: theme.text }]}>Detection Results</Text>
                <TouchableOpacity
                  onPress={() => setShowResultModal(false)}
                  style={styles.closeButton}
                >
                  <Ionicons name="close" size={24} color={theme.text} />
                </TouchableOpacity>
              </View>

              {result && (
                <>
                  {result.annotatedImageUrl && (
                    <Image
                      source={{ uri: result.annotatedImageUrl }}
                      style={styles.resultImage}
                      resizeMode="contain"
                    />
                  )}

                  <View style={styles.resultSection}>
                    <Text style={[styles.resultLabel, { color: theme.textSecondary }]}>Status:</Text>
                    <Text style={[styles.resultValue, { color: result.pass_ ? theme.success : theme.error }]}>
                      {result.pass_ ? '✅ PASSED' : '❌ FAILED'}
                    </Text>
                  </View>

                  <View style={styles.resultSection}>
                    <Text style={[styles.resultLabel, { color: theme.textSecondary }]}>Pills Detected:</Text>
                    <Text style={[styles.resultValue, { color: theme.text }]}>
                      {result.count}
                    </Text>
                  </View>

                  <View style={styles.resultSection}>
                    <Text style={[styles.resultLabel, { color: theme.textSecondary }]}>Confidence:</Text>
                    <Text style={[styles.resultValue, { color: theme.text }]}>
                      {(result.confidence * 100).toFixed(1)}%
                    </Text>
                  </View>

                  {result.classesDetected && result.classesDetected.length > 0 && (
                    <View style={styles.resultSection}>
                      <Text style={[styles.resultLabel, { color: theme.textSecondary }]}>Detected Types:</Text>
                      {result.classesDetected.map((item, index) => (
                        <Text key={index} style={[styles.resultValue, { color: theme.text }]}>
                          • {item.label} ({item.n} pill{item.n !== 1 ? 's' : ''})
                        </Text>
                      ))}
                    </View>
                  )}

                  <TouchableOpacity
                    style={[styles.modalButton, { backgroundColor: theme.primary }]}
                    onPress={() => {
                      setShowResultModal(false);
                      reset();
                    }}
                  >
                    <Text style={[styles.modalButtonText, { color: theme.card }]}>Done</Text>
                  </TouchableOpacity>
                </>
              )}
            </ScrollView>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 50,
    paddingBottom: 16,
  },
  backButton: {
    padding: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  content: {
    padding: 16,
  },
  description: {
    fontSize: 14,
    marginBottom: 24,
    textAlign: 'center',
  },
  buttonContainer: {
    gap: 16,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    borderRadius: 12,
    gap: 12,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  imageContainer: {
    marginTop: 16,
  },
  previewImage: {
    width: '100%',
    height: 300,
    borderRadius: 12,
    marginBottom: 16,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
  },
  smallButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    borderRadius: 8,
    gap: 8,
  },
  smallButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  loadingContainer: {
    alignItems: 'center',
    marginTop: 32,
    gap: 12,
  },
  loadingText: {
    fontSize: 16,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    width: '90%',
    maxHeight: '80%',
    borderRadius: 16,
    padding: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  closeButton: {
    padding: 4,
  },
  resultImage: {
    width: '100%',
    height: 200,
    borderRadius: 8,
    marginBottom: 16,
  },
  resultSection: {
    marginBottom: 12,
  },
  resultLabel: {
    fontSize: 14,
    marginBottom: 4,
  },
  resultValue: {
    fontSize: 16,
    fontWeight: '600',
  },
  modalButton: {
    padding: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 16,
  },
  modalButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
  },
});

export default PillDetectionCamera;
