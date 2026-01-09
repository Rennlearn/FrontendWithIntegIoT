import React from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, Platform, Alert, Image } from 'react-native';
import BluetoothService from '@/services/BluetoothService';
import { soundService } from '@/services/soundService';

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

  React.useEffect(() => {
    setVerification(externalVerification || null);
  }, [externalVerification]);

  const handleStop = async () => {
    // Stop any phone-side alarm haptics/sound immediately (even if Bluetooth command fails)
    try {
      await soundService.stopSound();
    } catch {
      // ignore
    }

    try {
      // Send stop commands to Arduino (via Bluetooth) with retries for reliability.
      // `STOPLOCATE` stops both locate buzzer and alarm buzzer in the Arduino sketch.
      for (let i = 0; i < 3; i++) {
        // eslint-disable-next-line no-await-in-loop
        await BluetoothService.sendCommand('ALARMSTOP\n');
        // eslint-disable-next-line no-await-in-loop
        await BluetoothService.sendCommand('STOPLOCATE\n');
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 150));
      }
      console.log('[AlarmModal] ✅ Stop commands sent (ALARMSTOP + STOPLOCATE)');
    } catch (e) {
      console.warn('[AlarmModal] Error sending stop commands:', e);
    }

    // Immediate UI callback (e.g., mark schedule Done in UI)
    try {
      if (typeof onStopImmediate === 'function') onStopImmediate();
    } catch (e) {
      // ignore
    }

    // If a custom onStop handler was provided, call it and show verification result inside the modal
    if (typeof onStop === 'function') {
      setLoading(true);
      try {
        const v = await onStop(container);
        if (v) setVerification(v);
      } catch (err) {
        console.warn('[AlarmModal] onStop handler failed:', err);
      } finally {
        setLoading(false);
      }
    } else {
      // Dismiss the modal if there's no verification flow
      try {
        onDismiss();
      } catch (e) {
        // ignore
      }

      // Friendly feedback
      if (Platform.OS !== 'web') {
        Alert.alert('✅ Buzzer Stopped', 'The alarm has been stopped. Verifying medication...');
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

          {!verification && (
            <View style={styles.actions}>
              <TouchableOpacity onPress={handleStop} style={[styles.button, styles.stopButton]} disabled={loading}>
                <Text style={styles.buttonText}>{loading ? 'Stopping...' : 'Stop Alarm'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={async () => {
                  try {
                    await soundService.stopSound();
                  } catch {
                    // ignore
                  }
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

              {verification.annotatedUrl ? (
                <View style={{ width: '100%', height: 240, backgroundColor: '#eee', marginBottom: 8 }}>
                  <Image source={{ uri: verification.annotatedUrl }} style={{ width: '100%', height: '100%', resizeMode: 'cover' }} />
                </View>
              ) : (
                <Text style={{ color: '#666', marginBottom: 8 }}>No annotated image available</Text>
              )}

              <TouchableOpacity
                onPress={async () => {
                  try {
                    await soundService.stopSound();
                  } catch {
                    // ignore
                  }
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
  actions: { flexDirection: 'row', marginTop: 12 },
  button: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 8, marginHorizontal: 8 },
  stopButton: { backgroundColor: '#d9534f' },
  dismissButton: { backgroundColor: '#f0f0f0' },
  buttonText: { color: '#fff', fontWeight: '700' },
});
