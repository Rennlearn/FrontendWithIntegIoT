import React from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, Platform, Alert, Image, ActivityIndicator } from 'react-native';
import BluetoothService from '@/services/BluetoothService';
import { soundService } from '@/services/soundService';
import verificationService from '@/services/verificationService';

type Verification = {
  success: boolean;
  message?: string;
  result?: any;
  annotatedUrl?: string | null;
};

type Props = {
  visible: boolean;
  container: number;
  time: string;
  remainingAlarms?: number;
  onDismiss: () => void;
  onStopImmediate?: () => void; // optional callback for immediate UI update when user stops alarm
  // Optional async handler that triggers the post-pill capture and returns verification result
  onStop?: (container: number) => Promise<Verification | null>;
  // Optional verification data supplied externally (e.g., when ALARM_STOPPED came from hardware)
  externalVerification?: Verification | null;
};

export default function AlarmModal({ visible, container, time, remainingAlarms = 0, onDismiss, onStopImmediate, onStop, externalVerification }: Props) {
  const [loading, setLoading] = React.useState(false);
  const [verification, setVerification] = React.useState<Verification | null>(externalVerification || null);
  const [latestCaptureUrl, setLatestCaptureUrl] = React.useState<string | null>(null);
  const [loadingCapture, setLoadingCapture] = React.useState(false);

  React.useEffect(() => {
    setVerification(externalVerification || null);
  }, [externalVerification]);

  // Fetch latest capture image when modal becomes visible
  // CRITICAL: Always fetch fresh image to ensure latest capture is shown
  // Use cache-busting query parameter to prevent browser/React Native image caching
  React.useEffect(() => {
    if (!visible) {
      // Reset capture URL when modal closes to force fresh fetch on next open
      setLatestCaptureUrl(null);
      return;
    }

    // Fetch latest capture for this container
    const fetchLatestCapture = async () => {
      try {
        setLoadingCapture(true);
        const containerId = `container${container}`;
        const base = await verificationService.getBackendUrl();
        
        // CRITICAL: Add timestamp cache-busting parameter to ensure fresh fetch
        // This prevents React Native Image component from showing cached/old images
        const cacheBuster = `?t=${Date.now()}`;
        const response = await fetch(`${base}/captures/latest/${containerId}${cacheBuster}`, {
          method: 'GET',
          headers: { 
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
          },
        });

        if (response.ok) {
          const data = await response.json();
          // Prefer annotated image, fallback to raw image
          const captureUrl = data.latest?.annotated || data.latest?.raw;
          if (captureUrl) {
            // Construct full URL if it's a relative path
            // CRITICAL: Add cache-busting parameter to image URL to prevent image caching
            const separator = captureUrl.includes('?') ? '&' : '?';
            const fullUrl = captureUrl.startsWith('http') 
              ? `${captureUrl}${separator}t=${Date.now()}`
              : `${base}${captureUrl}${separator}t=${Date.now()}`;
            setLatestCaptureUrl(fullUrl);
            console.log(`[AlarmModal] ✅ Loaded latest capture for ${containerId}: ${fullUrl}`);
          } else {
            console.log(`[AlarmModal] ⚠️ No capture found for ${containerId}`);
            setLatestCaptureUrl(null);
          }
        } else {
          console.warn(`[AlarmModal] Failed to fetch latest capture: HTTP ${response.status}`);
          setLatestCaptureUrl(null);
        }
      } catch (error) {
        console.warn('[AlarmModal] Error fetching latest capture:', error);
        setLatestCaptureUrl(null);
      } finally {
        setLoadingCapture(false);
      }
    };

    fetchLatestCapture();
  }, [visible, container]);

  const handleStop = async () => {
    // Stop sound INSTANTLY - no delays
    soundService.stopSound().catch(() => {});

    // Call immediate callback INSTANTLY for UI update
    try {
      if (typeof onStopImmediate === 'function') onStopImmediate();
    } catch (e) {
      // ignore
    }

    // Send stop commands in background (non-blocking, fire and forget)
    // Don't wait for Bluetooth - stop UI immediately
    (async () => {
    try {
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

    // If a custom onStop handler was provided, call it and show verification result inside the modal
    if (typeof onStop === 'function') {
      setLoading(true);
      // Run verification in background, don't block UI
      onStop(container).then((v) => {
        if (v) setVerification(v);
        setLoading(false);
      }).catch((err) => {
        console.warn('[AlarmModal] onStop handler failed:', err);
        setLoading(false);
      });
    } else {
      // Dismiss the modal INSTANTLY if there's no verification flow
      try {
        onDismiss();
      } catch (e) {
        // ignore
      }
    }
  };

  return (
    <Modal 
      visible={visible} 
      transparent 
      animationType="slide"
      statusBarTranslucent
      hardwareAccelerated
      onRequestClose={onDismiss}
    >
      <View style={styles.overlay}>
        <View style={[styles.container, { maxHeight: '85%' }]}>
          <Text style={styles.title}>Medication Reminder</Text>
          <Text style={styles.subtitle}>Container {container} — {time}</Text>
          {remainingAlarms > 0 && <Text style={styles.remaining}>{remainingAlarms} more alarm(s) in queue</Text>}

          {/* Show latest capture image (always visible, even before verification) */}
          {/* CRITICAL: Only show ONE image - latest capture before verification, or verification result after */}
          {loadingCapture ? (
            <View style={styles.imageContainer}>
              <ActivityIndicator size="large" color="#666" />
              <Text style={styles.imageLoadingText}>Loading latest capture...</Text>
            </View>
          ) : latestCaptureUrl ? (
            <View style={styles.imageContainer}>
              <Image 
                source={{ 
                  uri: latestCaptureUrl,
                  // CRITICAL: Disable caching to ensure latest image is always shown
                  cache: 'reload' as any
                }} 
                style={styles.captureImage}
                resizeMode="cover"
              />
              <Text style={styles.imageLabel}>Latest Capture</Text>
            </View>
          ) : null}

          {!verification && (
            <View style={styles.actions}>
              <TouchableOpacity onPress={handleStop} style={[styles.button, styles.stopButton]} disabled={loading}>
                <Text style={styles.buttonText}>{loading ? 'Stopping...' : 'Stop Alarm'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  // Stop sound INSTANTLY
                  soundService.stopSound().catch(() => {});
                  // Dismiss INSTANTLY
                  onDismiss();
                }}
                style={[styles.button, styles.dismissButton]}
                disabled={loading}
              >
                <Text style={[styles.buttonText, { color: '#333' }]}>Dismiss</Text>
              </TouchableOpacity>
            </View>
          )}

          {verification && (
            <View style={{ marginTop: 12, alignItems: 'center' }}>
              <Text style={{ fontWeight: '700', marginBottom: 8 }}>{verification.success ? '✅ Verified' : '⚠️ Verification'} </Text>
              {verification.result && (
                <Text style={{ marginBottom: 6, color: '#666' }}>Confidence: {(Number(verification.result.confidence || 0) * 100).toFixed(1)}%</Text>
              )}
              {verification.result && (
                <>
                  <Text style={{ marginBottom: 4, color: '#666' }}>
                    Detected: {Array.isArray(verification.result.classesDetected) && verification.result.classesDetected.length > 0
                      ? verification.result.classesDetected.map((c: any) => `${c.label} (${c.n})`).join(', ')
                      : 'none'}
                  </Text>
                  <Text style={{ marginBottom: 8, color: '#666' }}>
                    Total: {Number(verification.result.count || 0)} pill(s)
                  </Text>
                </>
              )}

              {/* Show verification annotated image if available, otherwise show latest capture */}
              {/* CRITICAL: Only show ONE image - verification result takes priority over latest capture */}
              {verification.annotatedUrl ? (
                <View style={styles.imageContainer}>
                  <Image 
                    source={{ 
                      uri: verification.annotatedUrl,
                      // CRITICAL: Disable caching to ensure latest verification image is shown
                      cache: 'reload' as any
                    }} 
                    style={styles.captureImage}
                    resizeMode="cover"
                  />
                  <Text style={styles.imageLabel}>Verification Result</Text>
                </View>
              ) : latestCaptureUrl ? (
                <View style={styles.imageContainer}>
                  <Image 
                    source={{ 
                      uri: latestCaptureUrl,
                      // CRITICAL: Disable caching to ensure latest capture is shown
                      cache: 'reload' as any
                    }} 
                    style={styles.captureImage}
                    resizeMode="cover"
                  />
                  <Text style={styles.imageLabel}>Latest Capture</Text>
                </View>
              ) : (
                <Text style={{ color: '#666', marginBottom: 8 }}>No image available</Text>
              )}

              <TouchableOpacity
                onPress={() => {
                  // Stop sound INSTANTLY
                  soundService.stopSound().catch(() => {});
                  // Dismiss INSTANTLY
                  onDismiss();
                }}
                style={[styles.button, { backgroundColor: '#28a745' }]}
              >
                <Text style={styles.buttonText}>Done</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10000,
    elevation: 1000,
  },
  container: {
    width: '90%',
    backgroundColor: '#fff',
    padding: 20,
    borderRadius: 12,
    alignItems: 'center',
    zIndex: 10001,
    elevation: 1001,
  },
  title: { fontSize: 20, fontWeight: '700', marginBottom: 6 },
  subtitle: { fontSize: 16, marginBottom: 8 },
  remaining: { fontSize: 12, color: '#666', marginBottom: 12 },
  imageContainer: {
    width: '100%',
    height: 240,
    backgroundColor: '#eee',
    marginTop: 12,
    marginBottom: 12,
    borderRadius: 8,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureImage: {
    width: '100%',
    height: '100%',
  },
  imageLabel: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    color: '#fff',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    fontSize: 12,
    fontWeight: '600',
  },
  imageLoadingText: {
    marginTop: 8,
    color: '#666',
    fontSize: 12,
  },
  actions: { flexDirection: 'row', marginTop: 12 },
  button: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8, marginHorizontal: 8 },
  stopButton: { backgroundColor: '#d9534f' },
  dismissButton: { backgroundColor: '#f0f0f0' },
  buttonText: { color: '#fff', fontWeight: '700' },
});
