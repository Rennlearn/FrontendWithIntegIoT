package com.anonymous.Pillnow;

import android.app.Activity;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.util.Log;

import com.facebook.react.bridge.ActivityEventListener;
import com.facebook.react.bridge.BaseActivityEventListener;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.modules.core.DeviceEventManagerModule;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.util.Set;
import java.util.UUID;

public class BluetoothAdapterModule extends ReactContextBaseJavaModule {
    private static final String TAG = "BluetoothAdapterModule";
    private static final UUID SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    private static final int REQUEST_ENABLE_BT = 1001;
    
    private BluetoothAdapter bluetoothAdapter;
    private BluetoothSocket currentSocket;
    private InputStream inputStream;
    private OutputStream outputStream;
    private BluetoothDevice currentDevice;
    private java.util.List<BluetoothDevice> discoveredDevices = new java.util.ArrayList<>();
    private Promise enableBluetoothPromise;
    private Thread dataReadThread;
    private boolean shouldReadData = false;

    private final ActivityEventListener activityEventListener = new BaseActivityEventListener() {
        @Override
        public void onActivityResult(Activity activity, int requestCode, int resultCode, Intent intent) {
            if (requestCode == REQUEST_ENABLE_BT) {
                if (enableBluetoothPromise != null) {
                    if (resultCode == Activity.RESULT_OK) {
                        Log.d(TAG, "User enabled Bluetooth");
                        enableBluetoothPromise.resolve(true);
                    } else {
                        Log.d(TAG, "User denied Bluetooth enable");
                        enableBluetoothPromise.reject("BLUETOOTH_DENIED", "User denied Bluetooth enable request");
                    }
                    enableBluetoothPromise = null;
                }
            }
        }
    };

    public BluetoothAdapterModule(ReactApplicationContext reactContext) {
        super(reactContext);
        bluetoothAdapter = BluetoothAdapter.getDefaultAdapter();
        reactContext.addActivityEventListener(activityEventListener);
    }

    @Override
    public String getName() {
        return "BluetoothAdapter";
    }

    @ReactMethod
    public void isEnabled(Promise promise) {
        try {
            if (bluetoothAdapter == null) {
                promise.resolve(false);
                return;
            }
            boolean enabled = bluetoothAdapter.isEnabled();
            Log.d(TAG, "Bluetooth enabled: " + enabled);
            promise.resolve(enabled);
        } catch (Exception e) {
            Log.e(TAG, "Error checking Bluetooth status", e);
            promise.reject("BLUETOOTH_ERROR", e.getMessage());
        }
    }

    @ReactMethod
    public void enable(Promise promise) {
        try {
            if (bluetoothAdapter == null) {
                Log.e(TAG, "Bluetooth adapter is null");
                promise.reject("BLUETOOTH_ERROR", "Bluetooth adapter not available");
                return;
            }
            
            if (bluetoothAdapter.isEnabled()) {
                Log.d(TAG, "Bluetooth is already enabled");
                promise.resolve(true);
                return;
            }
            
            Activity currentActivity = getCurrentActivity();
            if (currentActivity == null) {
                Log.e(TAG, "Current activity is null - cannot show Bluetooth enable dialog");
                promise.reject("BLUETOOTH_ERROR", "Activity not available. Please try again.");
                return;
            }
            
            // On Android 12+ (API 31+), we need to use an Intent to request Bluetooth enable
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                Log.d(TAG, "Android 12+ detected - using Intent to enable Bluetooth");
                try {
                    enableBluetoothPromise = promise;
                    Intent enableBtIntent = new Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE);
                    currentActivity.startActivityForResult(enableBtIntent, REQUEST_ENABLE_BT);
                    Log.d(TAG, "Bluetooth enable Intent sent to user");
                    // Promise will be resolved/rejected in onActivityResult
                } catch (Exception e) {
                    Log.e(TAG, "Error starting Bluetooth enable Intent", e);
                    enableBluetoothPromise = null;
                    promise.reject("BLUETOOTH_ERROR", "Failed to request Bluetooth enable: " + e.getMessage());
                }
            } else {
                // On older Android versions, we can enable directly
                Log.d(TAG, "Android < 12 - enabling Bluetooth directly");
                try {
                    boolean enabled = bluetoothAdapter.enable();
                    Log.d(TAG, "Bluetooth enable() called, result: " + enabled);
                    
                    // Wait a moment and check if it actually enabled
                    Thread.sleep(500);
                    if (bluetoothAdapter.isEnabled()) {
                        Log.d(TAG, "Bluetooth successfully enabled");
                        promise.resolve(true);
                    } else {
                        Log.w(TAG, "Bluetooth enable() returned true but Bluetooth is still not enabled");
                        // Try using Intent as fallback
                        enableBluetoothPromise = promise;
                        Intent enableBtIntent = new Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE);
                        currentActivity.startActivityForResult(enableBtIntent, REQUEST_ENABLE_BT);
                    }
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    promise.reject("BLUETOOTH_ERROR", "Interrupted while enabling Bluetooth");
                } catch (Exception e) {
                    Log.e(TAG, "Error enabling Bluetooth directly", e);
                    promise.reject("BLUETOOTH_ERROR", "Failed to enable Bluetooth: " + e.getMessage());
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Error enabling Bluetooth", e);
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

            Set<BluetoothDevice> pairedDevices = bluetoothAdapter.getBondedDevices();
            WritableArray deviceArray = Arguments.createArray();

            for (BluetoothDevice device : pairedDevices) {
                WritableMap deviceMap = Arguments.createMap();
                String name = device.getName();
                String address = device.getAddress();
                
                deviceMap.putString("name", name != null ? name : "Unknown Device");
                deviceMap.putString("address", address);
                deviceMap.putBoolean("connected", false);
                
                deviceArray.pushMap(deviceMap);
                Log.d(TAG, "Found paired device: " + name + " (" + address + ")");
            }

            promise.resolve(deviceArray);
        } catch (Exception e) {
            Log.e(TAG, "Error getting bonded devices", e);
            promise.reject("BLUETOOTH_ERROR", e.getMessage());
        }
    }

    @ReactMethod
    public void startDiscovery(Promise promise) {
        try {
            if (bluetoothAdapter == null) {
                promise.reject("BLUETOOTH_ERROR", "Bluetooth adapter not available");
                return;
            }
            
            if (!bluetoothAdapter.isEnabled()) {
                promise.reject("BLUETOOTH_ERROR", "Bluetooth is not enabled");
                return;
            }

            if (bluetoothAdapter.isDiscovering()) {
                bluetoothAdapter.cancelDiscovery();
            }

            boolean started = bluetoothAdapter.startDiscovery();
            Log.d(TAG, "Discovery started: " + started);
            promise.resolve(started);
        } catch (Exception e) {
            Log.e(TAG, "Error starting discovery", e);
            promise.reject("BLUETOOTH_ERROR", e.getMessage());
        }
    }

    @ReactMethod
    public void connectToDevice(String address, Promise promise) {
        // Run connection in a background thread to avoid blocking
        new Thread(() -> {
            try {
                if (bluetoothAdapter == null) {
                    promise.reject("BLUETOOTH_ERROR", "Bluetooth adapter not available");
                    return;
                }

                if (!bluetoothAdapter.isEnabled()) {
                    promise.reject("BLUETOOTH_ERROR", "Bluetooth is not enabled");
                    return;
                }

                // Cancel any ongoing discovery
                if (bluetoothAdapter.isDiscovering()) {
                    bluetoothAdapter.cancelDiscovery();
                    Thread.sleep(500); // Wait for discovery to fully cancel
                }

                // Get device by address
                BluetoothDevice device = bluetoothAdapter.getRemoteDevice(address);
                if (device == null) {
                    promise.reject("BLUETOOTH_ERROR", "Device not found: " + address);
                    return;
                }

                Log.d(TAG, "Attempting to connect to: " + device.getName() + " (" + address + ")");

                // Close existing connection if any
                if (currentSocket != null) {
                    try {
                        if (currentSocket.isConnected()) {
                            currentSocket.close();
                        }
                    } catch (IOException e) {
                        Log.w(TAG, "Error closing existing socket", e);
                    }
                    currentSocket = null;
                    currentDevice = null;
                    outputStream = null;
                }

                // Wait a moment before attempting new connection
                Thread.sleep(300);

                // Try multiple connection methods
                BluetoothSocket socket = null;
                Exception lastException = null;

                // Method 1: Try standard SPP UUID
                try {
                    Log.d(TAG, "Trying connection method 1: Standard SPP UUID");
                    socket = device.createRfcommSocketToServiceRecord(SPP_UUID);
                    socket.connect();
                    Log.d(TAG, "✅ Connected using method 1 (Standard SPP UUID)");
                } catch (IOException e) {
                    Log.w(TAG, "Method 1 failed: " + e.getMessage());
                    lastException = e;
                    if (socket != null) {
                        try {
                            socket.close();
                        } catch (IOException closeE) {
                            Log.w(TAG, "Error closing socket", closeE);
                        }
                    }
                    socket = null;

                    // Method 2: Try using reflection to get the socket (fallback for some devices)
                    try {
                        Log.d(TAG, "Trying connection method 2: Reflection fallback");
                        socket = (BluetoothSocket) device.getClass()
                            .getMethod("createRfcommSocket", int.class)
                            .invoke(device, 1);
                        socket.connect();
                        Log.d(TAG, "✅ Connected using method 2 (Reflection fallback)");
                    } catch (Exception e2) {
                        Log.w(TAG, "Method 2 failed: " + e2.getMessage());
                        lastException = e2;
                        if (socket != null) {
                            try {
                                socket.close();
                            } catch (IOException closeE) {
                                Log.w(TAG, "Error closing socket", closeE);
                            }
                        }
                        socket = null;

                        // Method 3: Try insecure RFCOMM (for unpaired devices)
                        try {
                            Log.d(TAG, "Trying connection method 3: Insecure RFCOMM");
                            socket = device.createInsecureRfcommSocketToServiceRecord(SPP_UUID);
                            socket.connect();
                            Log.d(TAG, "✅ Connected using method 3 (Insecure RFCOMM)");
                        } catch (Exception e3) {
                            Log.w(TAG, "Method 3 failed: " + e3.getMessage());
                            lastException = e3;
                            if (socket != null) {
                                try {
                                    socket.close();
                                } catch (IOException closeE) {
                                    Log.w(TAG, "Error closing socket", closeE);
                                }
                            }
                            socket = null;
                        }
                    }
                }

                if (socket != null && socket.isConnected()) {
                    currentSocket = socket;
                    currentDevice = device;
                    inputStream = socket.getInputStream();
                    outputStream = socket.getOutputStream();
                    Log.d(TAG, "✅ Successfully connected to " + device.getName() + " (" + address + ")");
                    
                    // Start background thread to read incoming data
                    startDataReadThread();
                    
                    promise.resolve(true);
                } else {
                    String errorMsg = "Failed to connect after trying all methods";
                    if (lastException != null) {
                        errorMsg += ": " + lastException.getMessage();
                    }
                    Log.e(TAG, "❌ " + errorMsg);
                    promise.reject("CONNECTION_FAILED", errorMsg);
                }
            } catch (SecurityException e) {
                Log.e(TAG, "❌ Security exception during connection", e);
                promise.reject("SECURITY_ERROR", "Bluetooth permission denied: " + e.getMessage());
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                Log.e(TAG, "❌ Connection interrupted", e);
                promise.reject("CONNECTION_ERROR", "Connection interrupted");
            } catch (Exception e) {
                Log.e(TAG, "❌ Unexpected connection error", e);
                promise.reject("BLUETOOTH_ERROR", "Connection failed: " + e.getMessage());
            }
        }).start();
    }

    private void startDataReadThread() {
        // Stop existing thread if any
        stopDataReadThread();
        
        shouldReadData = true;
        dataReadThread = new Thread(() -> {
            BufferedReader reader = null;
            try {
                if (inputStream == null) {
                    Log.e(TAG, "Input stream is null, cannot read data");
                    return;
                }
                
                reader = new BufferedReader(new InputStreamReader(inputStream));
                Log.d(TAG, "📡 Started reading data from Bluetooth device...");
                
                String line;
                while (shouldReadData && currentSocket != null && currentSocket.isConnected()) {
                    try {
                        line = reader.readLine();
                        if (line != null && !line.trim().isEmpty()) {
                            Log.d(TAG, "📨 Received data: " + line);
                            // Emit event to React Native
                            sendDataReceivedEvent(line.trim());
                        }
                    } catch (IOException e) {
                        if (shouldReadData) {
                            Log.e(TAG, "Error reading data", e);
                        }
                        break;
                    }
                }
            } catch (Exception e) {
                Log.e(TAG, "Error in data read thread", e);
            } finally {
                if (reader != null) {
                    try {
                        reader.close();
                    } catch (IOException e) {
                        Log.w(TAG, "Error closing reader", e);
                    }
                }
                Log.d(TAG, "📡 Stopped reading data from Bluetooth device");
            }
        });
        dataReadThread.start();
    }
    
    private void stopDataReadThread() {
        shouldReadData = false;
        if (dataReadThread != null) {
            try {
                dataReadThread.interrupt();
            } catch (Exception e) {
                Log.w(TAG, "Error interrupting data read thread", e);
            }
            dataReadThread = null;
        }
    }
    
    private void sendDataReceivedEvent(String data) {
        try {
            ReactApplicationContext reactContext = getReactApplicationContext();
            if (reactContext != null) {
                reactContext
                    .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                    .emit("BluetoothDataReceived", data);
                Log.d(TAG, "✅ Emitted BluetoothDataReceived event: " + data);
            } else {
                Log.e(TAG, "React context is null, cannot emit event");
            }
        } catch (Exception e) {
            Log.e(TAG, "Error emitting BluetoothDataReceived event", e);
        }
    }

    @ReactMethod
    public void disconnect(Promise promise) {
        try {
            // Stop data reading thread
            stopDataReadThread();
            
            if (inputStream != null) {
                try {
                    inputStream.close();
                } catch (IOException e) {
                    Log.w(TAG, "Error closing input stream", e);
                }
                inputStream = null;
            }
            
            if (outputStream != null) {
                try {
                    outputStream.close();
                } catch (IOException e) {
                    Log.w(TAG, "Error closing output stream", e);
                }
                outputStream = null;
            }

            if (currentSocket != null) {
                try {
                    currentSocket.close();
                } catch (IOException e) {
                    Log.w(TAG, "Error closing socket", e);
                }
                currentSocket = null;
            }

            currentDevice = null;
            Log.d(TAG, "Disconnected from device");
            promise.resolve(true);
        } catch (Exception e) {
            Log.e(TAG, "Error disconnecting", e);
            promise.reject("BLUETOOTH_ERROR", e.getMessage());
        }
    }

    @ReactMethod
    public void isConnected(Promise promise) {
        try {
            boolean connected = currentSocket != null && currentSocket.isConnected();
            Log.d(TAG, "Connection status: " + connected);
            promise.resolve(connected);
        } catch (Exception e) {
            Log.e(TAG, "Error checking connection", e);
            promise.resolve(false);
        }
    }

    @ReactMethod
    public void sendData(String data, Promise promise) {
        try {
            if (currentSocket == null || !currentSocket.isConnected()) {
                promise.reject("CONNECTION_ERROR", "Not connected to device");
                return;
            }

            if (outputStream == null) {
                promise.reject("CONNECTION_ERROR", "Output stream not available");
                return;
            }

            outputStream.write(data.getBytes());
            outputStream.write('\n'); // Add newline for Arduino
            outputStream.flush();
            
            Log.d(TAG, "✅ Data sent: " + data);
            promise.resolve(true);
        } catch (IOException e) {
            Log.e(TAG, "❌ Failed to send data", e);
            promise.reject("SEND_ERROR", "Failed to send data: " + e.getMessage());
        } catch (Exception e) {
            Log.e(TAG, "❌ Send error", e);
            promise.reject("BLUETOOTH_ERROR", e.getMessage());
        }
    }

    @ReactMethod
    public void getDiscoveredDevices(Promise promise) {
        try {
            discoveredDevices.clear();
            
            if (bluetoothAdapter == null || !bluetoothAdapter.isEnabled()) {
                promise.resolve(Arguments.createArray());
                return;
            }

            // Get all bonded devices (paired devices)
            Set<BluetoothDevice> bondedDevices = bluetoothAdapter.getBondedDevices();
            WritableArray deviceArray = Arguments.createArray();

            for (BluetoothDevice device : bondedDevices) {
                WritableMap deviceMap = Arguments.createMap();
                String name = device.getName();
                String address = device.getAddress();
                
                deviceMap.putString("name", name != null ? name : "Unknown Device");
                deviceMap.putString("address", address);
                deviceMap.putBoolean("connected", false);
                
                deviceArray.pushMap(deviceMap);
            }

            Log.d(TAG, "Returning " + deviceArray.size() + " discovered devices");
            promise.resolve(deviceArray);
        } catch (Exception e) {
            Log.e(TAG, "Error getting discovered devices", e);
            promise.reject("BLUETOOTH_ERROR", e.getMessage());
        }
    }

    @ReactMethod
    public void testModule(Promise promise) {
        try {
            WritableMap result = Arguments.createMap();
            result.putBoolean("available", bluetoothAdapter != null);
            if (bluetoothAdapter != null) {
                result.putBoolean("enabled", bluetoothAdapter.isEnabled());
            }
            promise.resolve(result);
        } catch (Exception e) {
            promise.reject("TEST_ERROR", e.getMessage());
        }
    }
}

