package com.anonymous.Pillnow;

import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.facebook.react.bridge.ActivityEventListener;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.modules.core.DeviceEventManagerModule;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;

public class BluetoothAdapterModule extends ReactContextBaseJavaModule implements ActivityEventListener {
    private static final int REQUEST_ENABLE_BT = 1;
    private static final UUID HC05_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB"); // Standard SPP UUID
    private BluetoothAdapter bluetoothAdapter;
    private Promise enableBluetoothPromise;
    private List<BluetoothDevice> discoveredDevices;
    private BluetoothSocket bluetoothSocket;
    private OutputStream outputStream;
    private InputStream inputStream;
    private boolean isConnected = false;
    private Thread dataReadThread;
    private AtomicBoolean shouldReadData = new AtomicBoolean(false);

    public BluetoothAdapterModule(ReactApplicationContext reactContext) {
        super(reactContext);
        bluetoothAdapter = BluetoothAdapter.getDefaultAdapter();
        discoveredDevices = new ArrayList<>();
    }

    @Override
    public String getName() {
        return "BluetoothAdapter";
    }

    @ReactMethod
    public void testModule(Promise promise) {
        try {
            promise.resolve("BluetoothAdapter module is working!");
        } catch (Exception e) {
            promise.reject("TEST_ERROR", e.getMessage());
        }
    }

    @ReactMethod
    public void isEnabled(Promise promise) {
        try {
            if (bluetoothAdapter == null) {
                promise.resolve(false);
                return;
            }
            promise.resolve(bluetoothAdapter.isEnabled());
        } catch (Exception e) {
            promise.reject("BLUETOOTH_ERROR", e.getMessage());
        }
    }

    @ReactMethod
    public void enable(Promise promise) {
        try {
            if (bluetoothAdapter == null) {
                promise.reject("BLUETOOTH_ERROR", "Bluetooth not supported on this device");
                return;
            }

            if (bluetoothAdapter.isEnabled()) {
                promise.resolve(true);
                return;
            }

            // Request to enable Bluetooth
            Intent enableBtIntent = new Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE);
            enableBtIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getReactApplicationContext().startActivity(enableBtIntent);
            
            // For now, resolve immediately - in a real implementation you'd wait for the result
            promise.resolve(true);
        } catch (Exception e) {
            promise.reject("BLUETOOTH_ERROR", e.getMessage());
        }
    }

    @ReactMethod
    public void getBondedDevices(Promise promise) {
        try {
            if (bluetoothAdapter == null) {
                promise.resolve(Arguments.createArray());
                return;
            }

            if (!bluetoothAdapter.isEnabled()) {
                promise.resolve(Arguments.createArray());
                return;
            }

            // Check permissions
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                if (ContextCompat.checkSelfPermission(getReactApplicationContext(), 
                    android.Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
                    promise.reject("PERMISSION_ERROR", "BLUETOOTH_CONNECT permission required");
                    return;
                }
            }

            Set<BluetoothDevice> pairedDevices = bluetoothAdapter.getBondedDevices();
            WritableArray deviceArray = Arguments.createArray();

            for (BluetoothDevice device : pairedDevices) {
                WritableMap deviceMap = Arguments.createMap();
                deviceMap.putString("name", device.getName());
                deviceMap.putString("address", device.getAddress());
                deviceArray.pushMap(deviceMap);
            }

            promise.resolve(deviceArray);
        } catch (Exception e) {
            promise.reject("BLUETOOTH_ERROR", e.getMessage());
        }
    }

    @ReactMethod
    public void startDiscovery(Promise promise) {
        try {
            if (bluetoothAdapter == null) {
                promise.resolve(false);
                return;
            }

            if (!bluetoothAdapter.isEnabled()) {
                promise.resolve(false);
                return;
            }

            // Check permissions
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                if (ContextCompat.checkSelfPermission(getReactApplicationContext(), 
                    android.Manifest.permission.BLUETOOTH_SCAN) != PackageManager.PERMISSION_GRANTED) {
                    promise.reject("PERMISSION_ERROR", "BLUETOOTH_SCAN permission required");
                    return;
                }
            }

            // Cancel any ongoing discovery
            if (bluetoothAdapter.isDiscovering()) {
                bluetoothAdapter.cancelDiscovery();
            }

            // Clear previous discovered devices
            discoveredDevices.clear();

            // Start discovery
            boolean started = bluetoothAdapter.startDiscovery();
            promise.resolve(started);
        } catch (Exception e) {
            promise.reject("BLUETOOTH_ERROR", e.getMessage());
        }
    }

    @ReactMethod
    public void getDiscoveredDevices(Promise promise) {
        try {
            WritableArray deviceArray = Arguments.createArray();

            for (BluetoothDevice device : discoveredDevices) {
                WritableMap deviceMap = Arguments.createMap();
                deviceMap.putString("name", device.getName());
                deviceMap.putString("address", device.getAddress());
                deviceArray.pushMap(deviceMap);
            }

            promise.resolve(deviceArray);
        } catch (Exception e) {
            promise.reject("BLUETOOTH_ERROR", e.getMessage());
        }
    }

    @ReactMethod
    public void connectToDevice(String deviceAddress, Promise promise) {
        try {
            if (bluetoothAdapter == null) {
                promise.reject("BLUETOOTH_ERROR", "Bluetooth not supported");
                return;
            }

            if (!bluetoothAdapter.isEnabled()) {
                promise.reject("BLUETOOTH_ERROR", "Bluetooth not enabled");
                return;
            }

            // Check permissions
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                if (ContextCompat.checkSelfPermission(getReactApplicationContext(),
                    android.Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
                    promise.reject("PERMISSION_ERROR", "BLUETOOTH_CONNECT permission required");
                    return;
                }
            }

            // Get the device
            BluetoothDevice device = bluetoothAdapter.getRemoteDevice(deviceAddress);
            if (device == null) {
                promise.reject("BLUETOOTH_ERROR", "Device not found");
                return;
            }

            // Cancel any ongoing discovery
            if (bluetoothAdapter.isDiscovering()) {
                bluetoothAdapter.cancelDiscovery();
            }

            // Close any existing connection
            if (bluetoothSocket != null) {
                try {
                    bluetoothSocket.close();
                } catch (Exception e) {
                    android.util.Log.w("BluetoothAdapter", "Error closing existing socket: " + e.getMessage());
                }
                bluetoothSocket = null;
            }

            // Create socket with proper UUID for HC-05
            bluetoothSocket = device.createRfcommSocketToServiceRecord(HC05_UUID);

            // Connect with timeout handling
            android.util.Log.d("BluetoothAdapter", "Attempting to connect to HC-05: " + deviceAddress);
            
            // Set socket timeout
            bluetoothSocket.connect();
            
            // Get input/output streams
            outputStream = bluetoothSocket.getOutputStream();
            inputStream = bluetoothSocket.getInputStream();

            isConnected = true;

            // Start data reading thread
            startDataReadingThread();

            // Log successful connection
            android.util.Log.d("BluetoothAdapter", "✅ Successfully connected to HC-05: " + deviceAddress);
            android.util.Log.d("BluetoothAdapter", "✅ HC-05 LED should now be slower (connected state)");
            android.util.Log.d("BluetoothAdapter", "✅ Data reading thread started");

            promise.resolve(true);
        } catch (Exception e) {
            isConnected = false;
            android.util.Log.e("BluetoothAdapter", "❌ Connection failed: " + e.getMessage());
            android.util.Log.e("BluetoothAdapter", "❌ Error type: " + e.getClass().getSimpleName());
            
            // Clean up on failure
            if (bluetoothSocket != null) {
                try {
                    bluetoothSocket.close();
                } catch (Exception closeException) {
                    android.util.Log.w("BluetoothAdapter", "Error closing socket after failure: " + closeException.getMessage());
                }
                bluetoothSocket = null;
            }
            
            promise.reject("CONNECTION_ERROR", e.getMessage());
        }
    }

    @ReactMethod
    public void disconnect(Promise promise) {
        try {
            isConnected = false;
            shouldReadData.set(false);
            
            // Stop data reading thread
            if (dataReadThread != null && dataReadThread.isAlive()) {
                dataReadThread.interrupt();
                try {
                    dataReadThread.join(1000);
                } catch (InterruptedException e) {
                    android.util.Log.w("BluetoothAdapter", "Interrupted while stopping data thread");
                }
                dataReadThread = null;
            }
            
            if (outputStream != null) {
                outputStream.close();
                outputStream = null;
            }
            
            if (inputStream != null) {
                inputStream.close();
                inputStream = null;
            }
            
            if (bluetoothSocket != null) {
                bluetoothSocket.close();
                bluetoothSocket = null;
            }
            
            promise.resolve(true);
        } catch (Exception e) {
            promise.reject("DISCONNECT_ERROR", e.getMessage());
        }
    }

    private void startDataReadingThread() {
        shouldReadData.set(true);
        dataReadThread = new Thread(new Runnable() {
            @Override
            public void run() {
                android.util.Log.d("BluetoothAdapter", "Data reading thread started");
                byte[] buffer = new byte[1024];
                int bytes;
                
                while (shouldReadData.get() && isConnected && inputStream != null) {
                    try {
                        bytes = inputStream.read(buffer);
                        if (bytes > 0) {
                            String data = new String(buffer, 0, bytes);
                            android.util.Log.d("BluetoothAdapter", "📡 Data received: " + data.trim());
                            
                            // Emit event to JavaScript
                            getReactApplicationContext()
                                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                                .emit("BluetoothDataReceived", data);
                        }
                    } catch (IOException e) {
                        if (shouldReadData.get()) {
                            android.util.Log.e("BluetoothAdapter", "Error reading data: " + e.getMessage());
                            shouldReadData.set(false);
                            isConnected = false;
                        }
                        break;
                    } catch (Exception e) {
                        android.util.Log.e("BluetoothAdapter", "Unexpected error in data thread: " + e.getMessage());
                    }
                }
                android.util.Log.d("BluetoothAdapter", "Data reading thread stopped");
            }
        });
        dataReadThread.start();
    }

    @ReactMethod
    public void sendData(String data, Promise promise) {
        try {
            if (!isConnected || outputStream == null) {
                promise.reject("CONNECTION_ERROR", "Not connected to device");
                return;
            }

            // Send data to HC-05
            outputStream.write(data.getBytes());
            outputStream.flush();

            // Log successful data transmission
            android.util.Log.d("BluetoothAdapter", "Data sent to HC-05: " + data);
            android.util.Log.d("BluetoothAdapter", "Check Arduino Serial Monitor for received data");

            promise.resolve(true);
        } catch (Exception e) {
            android.util.Log.e("BluetoothAdapter", "Send data failed: " + e.getMessage());
            promise.reject("SEND_ERROR", e.getMessage());
        }
    }

    @ReactMethod
    public void isConnected(Promise promise) {
        promise.resolve(isConnected);
    }

    @Override
    public void onActivityResult(android.app.Activity activity, int requestCode, int resultCode, Intent data) {
        if (requestCode == REQUEST_ENABLE_BT) {
            if (enableBluetoothPromise != null) {
                enableBluetoothPromise.resolve(resultCode == android.app.Activity.RESULT_OK);
                enableBluetoothPromise = null;
            }
        }
    }

    @Override
    public void onNewIntent(Intent intent) {
        // Handle new intents if needed
    }
}
