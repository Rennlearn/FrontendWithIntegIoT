import React from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, Platform, Alert, Image, ActivityIndicator, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { lightTheme, darkTheme } from '@/styles/theme';
import BluetoothService from '@/services/BluetoothService';
import { soundService } from '@/services/soundService';
import verificationService from '@/services/verificationService';

type Verification = {
  success: boolean;
  message?: string;
  result?: any;
  annotatedUrl?: string | null;
};

interface AlarmModalProps {
  visible: boolean;
  container: number;
  time: string;
  remainingAlarms?: number;
  isScheduled?: boolean; // Indicates if this alarm matches a scheduled medication time
  onDismiss: () => void;
  onStopImmediate?: () => void; // optional callback for immediate UI update when user stops alarm
  // Optional async handler that triggers the post-pill capture and returns verification result
  onStop?: (container: number) => Promise<Verification | null>;
  // Optional verification data supplied externally (e.g., when ALARM_STOPPED came from hardware)
  externalVerification?: Verification | null;
  // Legacy prop for backward compatibility
  onStopAlarm?: (container: number) => Promise<void>;
}

const AlarmModal: React.FC<AlarmModalProps> = ({ visible, container, time, remainingAlarms = 0, isScheduled = false, onDismiss, onStopImmediate, onStop, externalVerification, onStopAlarm }) => {
  const { isDarkMode } = useTheme();
  const theme = isDarkMode ? darkTheme : lightTheme;
  const [pulseAnim] = React.useState(new Animated.Value(1));
  const [loading, setLoading] = React.useState(false);
  const [verification, setVerification] = React.useState<Verification | null>(externalVerification || null);
  const [latestImageUrl, setLatestImageUrl] = React.useState<string | null>(null);
  const [loadingImage, setLoadingImage] = React.useState(false);

  // Pulse animation for alarm icon
  React.useEffect(() => {
    if (visible) {
      // Pulse animation
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.2,
            duration: 500,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 500,
            useNativeDriver: true,
          }),
        ])
      ).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [visible]);

  React.useEffect(() => {
    setVerification(externalVerification || null);
  }, [externalVerification]);

  // Fetch latest annotated image for this container when modal becomes visible
  React.useEffect(() => {
    if (visible && container > 0) {
      fetchLatestImage();
    } else {
      // Reset image when modal is hidden
      setLatestImageUrl(null);
    }
  }, [visible, container]);

  const fetchLatestImage = async () => {
    try {
      setLoadingImage(true);
      const base = await verificationService.getBackendUrl();
      const containerIdStr = `container${container}`;
      
      // Fetch latest annotated image for this container
      const response = await fetch(`${base}/captures/latest/${containerIdStr}?t=${Date.now()}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
        },
      });

      if (response.ok) {
        const data = await response.json();
        const imagePath = data.latest?.annotated || data.latest?.raw || null;
        
        if (imagePath) {
          // Construct full URL
          const fullUrl = imagePath.startsWith('http') 
            ? imagePath 
            : `${base}${imagePath}`;
          setLatestImageUrl(fullUrl);
          console.log(`[AlarmModal] ✅ Loaded latest image for Container ${container}: ${fullUrl}`);
        } else {
          console.log(`[AlarmModal] ⚠️ No image found for Container ${container}`);
          setLatestImageUrl(null);
        }
      } else {
        console.warn(`[AlarmModal] Failed to fetch latest image: ${response.status}`);
        setLatestImageUrl(null);
      }
    } catch (error) {
      console.warn(`[AlarmModal] Error fetching latest image for Container ${container}:`, error);
      setLatestImageUrl(null);
    } finally {
      setLoadingImage(false);
    }
  };

  const handleStop = async () => {
    // Stop sound INSTANTLY - no delays
    soundService.stopSound().catch(() => {});

    // Call immediate callback INSTANTLY for UI update
    try {
      if (typeof onStopImmediate === 'function') onStopImmediate();
    } catch (e) {
      // ignore
    }

    // CRITICAL: Dismiss modal INSTANTLY - don't wait for verification
    // User wants the modal to disappear immediately when Stop Alarm is clicked
    try {
      onDismiss();
    } catch (e) {
      // ignore
    }

    // Send stop commands in background (non-blocking, fire and forget)
    // Don't wait for Bluetooth - stop UI immediately
    (async () => {
      try {
        // IOT COMMUNICATION STABILITY: Check connection before sending to avoid timeout spam
        const isConnected = await BluetoothService.isConnectionActive();
        if (!isConnected) {
          // Bluetooth not connected - silently skip (expected when Bluetooth is off)
          return;
        }
        
        // Send stop commands to Arduino (via Bluetooth) with retries for reliability.
        // `STOPLOCATE` stops both locate buzzer and alarm buzzer in the Arduino sketch.
        for (let i = 0; i < 3; i++) {
          BluetoothService.sendCommand('ALARMSTOP\n').catch(() => {});
          BluetoothService.sendCommand('STOPLOCATE\n').catch(() => {});
          // Small delay between retries but don't block UI
          if (i < 2) {
            await new Promise((r) => setTimeout(r, 50));
          }
        }
        console.log('[AlarmModal] ✅ Stop commands sent (ALARMSTOP + STOPLOCATE)');
      } catch (e) {
        console.warn('[AlarmModal] Error sending stop commands:', e);
      }
    })();

    // If a custom onStop handler was provided, run verification in background
    // Modal is already dismissed, so verification runs silently in background
    if (typeof onStop === 'function') {
      // Run verification in background - modal is already dismissed
      onStop(container).catch((err) => {
        console.warn('[AlarmModal] onStop handler failed:', err);
      });
    } else if (typeof onStopAlarm === 'function') {
      // Backward compatible: call legacy onStopAlarm (no verification data)
      onStopAlarm(container).catch((err) => {
        console.warn('[AlarmModal] onStopAlarm callback failed:', err);
      });
    }
  };

  return (
    <Modal 
      visible={visible} 
      transparent 
      animationType="fade"
      statusBarTranslucent
      hardwareAccelerated
      onRequestClose={onDismiss}
    >
      <View style={styles.overlay}>
        <View style={[styles.container, { backgroundColor: theme.card, maxHeight: '85%' }]}>
          {/* Animated pulsing alarm icon */}
          <Animated.View style={[styles.iconContainer, { transform: [{ scale: pulseAnim }] }]}>
            <Ionicons name="alarm" size={80} color={theme.error} />
          </Animated.View>
          
          <Text style={[styles.title, { color: theme.secondary }]}>Time to Take Medication!</Text>
          <Text style={[styles.containerText, { color: theme.text }]}>Container {container}</Text>
          <Text style={[styles.timeText, { color: theme.textSecondary, marginBottom: remainingAlarms > 0 ? 10 : 16 }]}>{time}</Text>
          
          {remainingAlarms > 0 && (
            <View style={styles.remainingBadge}>
              <Ionicons name="notifications" size={16} color="#fff" />
              <Text style={styles.remainingText}>
                +{remainingAlarms} more medication{remainingAlarms > 1 ? 's' : ''} to take
              </Text>
            </View>
          )}

          {/* Scheduled badge - shows when alarm matches a scheduled medication time */}
          {isScheduled && (
            <View style={[styles.scheduledBadge, { backgroundColor: theme.success + '20', borderColor: theme.success }]}>
              <Ionicons name="checkmark-circle" size={16} color={theme.success} />
              <Text style={[styles.scheduledText, { color: theme.success }]}>
                Scheduled Medication
              </Text>
            </View>
          )}

          {/* Display latest annotated image for this container */}
          {loadingImage ? (
            <View style={styles.imageContainer}>
              <ActivityIndicator size="large" color="#007AFF" />
              <Text style={styles.imageLoadingText}>Loading image...</Text>
            </View>
          ) : latestImageUrl ? (
            <View style={styles.imageContainer}>
              <Image 
                source={{ uri: latestImageUrl }} 
                style={styles.captureImage}
                resizeMode="contain"
              />
              <Text style={styles.imageLabel}>Latest captured image</Text>
            </View>
          ) : (
            <View style={styles.imageContainer}>
              <Text style={styles.noImageText}>No image available</Text>
            </View>
          )}

          {!verification && (
            <View style={styles.actions}>
              <TouchableOpacity 
                onPress={handleStop} 
                style={[styles.stopButton, { backgroundColor: theme.primary }]} 
                disabled={loading}
              >
                <Ionicons name="stop-circle" size={24} color={theme.card} />
                <Text style={[styles.stopButtonText, { color: theme.card }]}>
                  {loading ? 'Stopping...' : 'Stop Alarm'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  // Stop sound INSTANTLY
                  soundService.stopSound().catch(() => {});
                  // Dismiss INSTANTLY
                  onDismiss();
                }}
                style={[styles.dismissButton, { backgroundColor: theme.background }]}
                disabled={loading}
              >
                <Text style={[styles.dismissButtonText, { color: theme.text }]}>Dismiss</Text>
              </TouchableOpacity>
            </View>
          )}

          {verification && (
            <View style={[styles.verificationContainer, { marginTop: 12, width: '100%' }]}>
              <View style={styles.verificationHeader}>
                <Ionicons 
                  name={verification.success ? 'checkmark-circle' : 'alert-circle'} 
                  size={24} 
                  color={verification.success ? theme.success : theme.error} 
                />
                <Text style={[styles.verificationTitle, { color: theme.text, marginLeft: 8 }]}>
                  {verification.success ? 'Verified' : 'Verification Failed'}
                </Text>
              </View>
              
              {verification.result && (
                <View style={styles.verificationDetails}>
                  <Text style={[styles.verificationText, { color: theme.textSecondary }]}>
                    Confidence: {(Number(verification.result.confidence || 0) * 100).toFixed(1)}%
                  </Text>
                  {Array.isArray(verification.result.classesDetected) && verification.result.classesDetected.length > 0 && (
                    <Text style={[styles.verificationText, { color: theme.textSecondary }]}>
                      Detected: {verification.result.classesDetected.map((c: any) => `${c.label} (${c.n})`).join(', ')}
                    </Text>
                  )}
                  <Text style={[styles.verificationText, { color: theme.textSecondary, fontWeight: '600' }]}>
                    Total: {Number(verification.result.count || 0)} pill(s)
                  </Text>
                </View>
              )}

              {/* Display verification image if available, otherwise show latest image */}
              {verification?.annotatedUrl ? (
                <View style={styles.imageContainer}>
                  <Image 
                    source={{ uri: verification.annotatedUrl }} 
                    style={styles.captureImage}
                    resizeMode="contain"
                  />
                  <Text style={[styles.imageLabel, { color: theme.textSecondary }]}>Verification result</Text>
                </View>
              ) : latestImageUrl ? (
                <View style={styles.imageContainer}>
                  <Image 
                    source={{ uri: latestImageUrl }} 
                    style={styles.captureImage}
                    resizeMode="contain"
                  />
                  <Text style={[styles.imageLabel, { color: theme.textSecondary }]}>Latest captured image</Text>
                </View>
              ) : null}

              {/* Stop and Dismiss buttons - always visible even with verification */}
              <View style={styles.actions}>
                <TouchableOpacity 
                  onPress={handleStop} 
                  style={[styles.stopButton, { backgroundColor: theme.primary }]} 
                  disabled={loading}
                >
                  <Ionicons name="stop-circle" size={24} color={theme.card} />
                  <Text style={[styles.stopButtonText, { color: theme.card }]}>
                    {loading ? 'Stopping...' : 'Stop Alarm'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => {
                    // Stop sound INSTANTLY
                    soundService.stopSound().catch(() => {});
                    // Dismiss INSTANTLY
                    onDismiss();
                  }}
                  style={[styles.dismissButton, { backgroundColor: theme.background }]}
                  disabled={loading}
                >
                  <Text style={[styles.dismissButtonText, { color: theme.text }]}>Dismiss</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10000,
    elevation: 1000,
  },
  container: {
    width: '85%',
    maxWidth: 400,
    padding: 30,
    borderRadius: 20,
    alignItems: 'center',
    zIndex: 10001,
    elevation: 10,
    maxHeight: '85%',
  },
  iconContainer: {
    marginBottom: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 10,
    textAlign: 'center',
  },
  containerText: {
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 8,
  },
  timeText: {
    fontSize: 16,
    // marginBottom is set dynamically based on remainingAlarms
  },
  remainingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FF6B6B',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 15,
    marginBottom: 20,
    gap: 6,
  },
  remainingText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  scheduledBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 15,
    marginBottom: 12,
    gap: 6,
    borderWidth: 1,
  },
  scheduledText: {
    fontSize: 13,
    fontWeight: '600',
  },
  imageContainer: {
    width: '100%',
    marginVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 200,
    maxHeight: 300,
  },
  captureImage: {
    width: '100%',
    height: 200,
    borderRadius: 8,
    backgroundColor: '#f5f5f5',
  },
  imageLabel: {
    fontSize: 12,
    marginTop: 8,
    textAlign: 'center',
  },
  imageLoadingText: {
    fontSize: 14,
    marginTop: 8,
  },
  noImageText: {
    fontSize: 14,
    fontStyle: 'italic',
  },
  actions: {
    flexDirection: 'row',
    marginTop: 12,
    gap: 12,
    width: '100%',
    justifyContent: 'center',
  },
  stopButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 30,
    paddingVertical: 15,
    borderRadius: 25,
    gap: 10,
    minWidth: 160,
    justifyContent: 'center',
  },
  stopButtonText: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  dismissButton: {
    paddingVertical: 15,
    paddingHorizontal: 24,
    borderRadius: 25,
    minWidth: 120,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dismissButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  verificationContainer: {
    alignItems: 'center',
    width: '100%',
  },
  verificationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    justifyContent: 'center',
  },
  verificationTitle: {
    fontWeight: '700',
    fontSize: 18,
  },
  verificationDetails: {
    alignItems: 'center',
    marginBottom: 12,
    width: '100%',
  },
  verificationText: {
    fontSize: 14,
    marginBottom: 4,
    textAlign: 'center',
  },
});

export default AlarmModal;
