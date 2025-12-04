import React, { useState, useEffect } from "react";
import { 
  View, Text, TextInput, TouchableOpacity, Alert, StyleSheet, ScrollView, Modal, ActivityIndicator, BackHandler
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import axios from "axios";
import { useRouter, useFocusEffect } from "expo-router";
import { useTheme } from "./context/ThemeContext";
import { lightTheme, darkTheme } from "./styles/theme";
import * as SMS from "expo-sms";

const LoginScreen = () => {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const { isDarkMode } = useTheme();
  const theme = isDarkMode ? darkTheme : lightTheme;

  const [isForgotOpen, setIsForgotOpen] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [isSendingCode, setIsSendingCode] = useState(false);
  const [generatedOTP, setGeneratedOTP] = useState<string | null>(null);
  const [showOTPInput, setShowOTPInput] = useState(false);
  const [enteredOTP, setEnteredOTP] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);

  // Track if user is logged in
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  // Check if user is already logged in when screen comes into focus
  useFocusEffect(
    React.useCallback(() => {
      const checkAuth = async () => {
        const token = await AsyncStorage.getItem("token");
        if (token) {
          setIsLoggedIn(true);
          // User is already logged in, redirect to appropriate dashboard
          try {
            const decodedToken = JSON.parse(atob(token.split('.')[1]));
            const roleId = parseInt(decodedToken.role || decodedToken.user?.role || "0");
            
            if (roleId === 3) {
              router.replace("/CaregiverDashboard");
            } else if (roleId === 2) {
              router.replace("/ElderDashboard");
            }
          } catch (error) {
            // If token is invalid, clear it and stay on login
            await AsyncStorage.removeItem("token");
            setIsLoggedIn(false);
          }
        } else {
          setIsLoggedIn(false);
          // Clear form when screen is focused and user is not logged in
          setEmail("");
          setPassword("");
        }
      };
      checkAuth();
    }, [])
  );

  // Prevent back button navigation if user is logged in
  useEffect(() => {
    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      // If user is logged in, prevent going back to login screen
      if (isLoggedIn) {
        return true; // Prevent default back behavior
      }
      return false; // Allow default back behavior if not logged in
    });

    return () => backHandler.remove();
  }, [isLoggedIn]);

  const handleLogin = async () => {
    try {
      setLoading(true);
      await AsyncStorage.removeItem("token"); // Clear previous token

      const response = await axios.post("https://pillnow-database.onrender.com/api/users/login", {
        email,
        password,
      });

      if (response.data?.token) {
        await AsyncStorage.setItem("token", response.data.token);
        console.log("Login successful. Token saved:", response.data.token);
        console.log("Full response data:", JSON.stringify(response.data, null, 2));
        
        // Check user role and navigate accordingly
        const userRole = response.data.user?.role || response.data.role;
        console.log("User role:", userRole);
        console.log("Response data.user:", response.data.user);
        console.log("Response data.role:", response.data.role);
        
        // Handle numeric role IDs: 1=Admin, 2=Elder, 3=Caregiver
        const roleId = parseInt(userRole);
        console.log("Role ID:", roleId);
        
        // Clear form inputs after successful login
        setEmail("");
        setPassword("");
        setIsLoggedIn(true);
        
        if (roleId === 3) {
          console.log("Navigating to CaregiverDashboard (Role ID: 3)");
          router.replace("/CaregiverDashboard");
        } else if (roleId === 2) {
          console.log("Navigating to ElderDashboard (Role ID: 2)");
          router.replace("/ElderDashboard");
        } else if (roleId === 1) {
          console.log("Admin role detected (Role ID: 1) - showing alert");
          Alert.alert("Login Failed", "Admin access not supported in this app.");
          setIsLoggedIn(false);
        } else {
          console.log("Unknown role, showing alert");
          // If role is not recognized, show an alert
          Alert.alert("Login Failed", "Invalid user role. Please contact support.");
          setIsLoggedIn(false);
        }
      } else {
        Alert.alert("Login Failed", "Invalid username or password");
      }
    } catch (error: any) {
      Alert.alert("Login Failed", error.response?.data?.message || "Invalid credentials");
    } finally {
      setLoading(false);
    }
  };

  const generateOTP = (length: number = 6): string => {
    // Generate a random OTP with the specified length
    const min = Math.pow(10, length - 1);
    const max = Math.pow(10, length) - 1;
    const otp = Math.floor(min + Math.random() * (max - min + 1)).toString();
    console.log("[OTP] Generated OTP:", otp, "Length:", otp.length);
    return otp;
  };

  const handleSendResetCode = async () => {
    console.log("[OTP] handleSendResetCode called");
    const trimmed = phoneNumber.trim();
    console.log("[OTP] Phone number entered:", trimmed);
    
    if (!trimmed) {
      console.log("[OTP] Error: Phone number is empty");
      Alert.alert("Missing Number", "Please enter your contact number.");
      return;
    }

    // Basic phone number validation
    const phoneRegex = /^[\d\s\-\+\(\)]+$/;
    if (!phoneRegex.test(trimmed) || trimmed.length < 10) {
      console.log("[OTP] Error: Invalid phone number format or too short");
      Alert.alert("Invalid Number", "Please enter a valid contact number.");
      return;
    }

    console.log("[OTP] Phone number validation passed");
    setIsSendingCode(true);
    console.log("[OTP] isSendingCode set to true");
    
    try {
      // Check if SMS is available
      console.log("[OTP] Checking SMS availability...");
      const isAvailable = await SMS.isAvailableAsync();
      console.log("[OTP] SMS available:", isAvailable);
      
      if (!isAvailable) {
        console.log("[OTP] Error: SMS not available on device");
        Alert.alert(
          "SMS Unavailable",
          "SMS is not available on this device. Please contact support or try another method."
        );
        setIsSendingCode(false);
        return;
      }

      // Generate a random 6-digit OTP
      const otp = generateOTP(6);
      console.log("[OTP] OTP generated and set in state:", otp);
      setGeneratedOTP(otp);
      
      // Store OTP in AsyncStorage for verification (optional, expires after 10 minutes)
      const otpData = {
        code: otp,
        phoneNumber: trimmed,
        timestamp: Date.now(),
        expiresAt: Date.now() + 10 * 60 * 1000 // 10 minutes
      };
      console.log("[OTP] Storing OTP data in AsyncStorage:", JSON.stringify(otpData, null, 2));
      await AsyncStorage.setItem("resetOTP", JSON.stringify(otpData));
      console.log("[OTP] OTP data stored successfully");

      // Verify storage
      const stored = await AsyncStorage.getItem("resetOTP");
      console.log("[OTP] Verified stored OTP:", stored);

      // Create the SMS message
      const message = `Your PILLNOW password reset code is: ${otp}. This code will expire in 10 minutes. Do not share this code with anyone.`;
      console.log("[OTP] SMS message prepared:", message);

      // Send SMS
      console.log("[OTP] Attempting to send SMS to:", trimmed);
      const result = await SMS.sendSMSAsync([trimmed], message);
      console.log("[OTP] SMS send result:", JSON.stringify(result, null, 2));
      
      if (result.result === "sent") {
        console.log("[OTP] SMS sent successfully, switching to OTP input view");
        // Switch to OTP verification step
        setShowOTPInput(true);
        console.log("[OTP] showOTPInput set to true");
        Alert.alert(
          "Code Sent", 
          `A 6-digit reset code has been sent to ${trimmed}. Please enter the code to verify.`
        );
      } else if (result.result === "cancelled") {
        console.log("[OTP] SMS sending was cancelled by user");
        Alert.alert("Cancelled", "SMS sending was cancelled.");
      } else {
        console.log("[OTP] SMS was not sent, result:", result.result);
        Alert.alert("Not Sent", "The SMS was not sent. Please try again.");
      }
    } catch (err: any) {
      console.error("[OTP] SMS Error:", err);
      console.error("[OTP] Error details:", JSON.stringify(err, null, 2));
      Alert.alert(
        "Error", 
        `Failed to send SMS: ${err.message || "Please try again."}`
      );
    } finally {
      setIsSendingCode(false);
      console.log("[OTP] isSendingCode set to false");
    }
  };

  const handleVerifyOTP = async () => {
    console.log("[OTP Verification] handleVerifyOTP called");
    console.log("[OTP Verification] Entered OTP:", enteredOTP);
    console.log("[OTP Verification] Entered OTP length:", enteredOTP.length);
    console.log("[OTP Verification] Generated OTP in state:", generatedOTP);
    
    if (!enteredOTP.trim()) {
      console.log("[OTP Verification] Error: OTP is empty");
      Alert.alert("Missing Code", "Please enter the 6-digit code.");
      return;
    }

    if (enteredOTP.length !== 6) {
      console.log("[OTP Verification] Error: OTP length is not 6");
      Alert.alert("Invalid Code", "Please enter a valid 6-digit code.");
      return;
    }

    setIsVerifying(true);
    console.log("[OTP Verification] isVerifying set to true");
    
    try {
      // Retrieve stored OTP data
      console.log("[OTP Verification] Retrieving OTP from AsyncStorage...");
      const storedOTPData = await AsyncStorage.getItem("resetOTP");
      console.log("[OTP Verification] Stored OTP data:", storedOTPData);
      
      if (!storedOTPData) {
        console.log("[OTP Verification] Error: No OTP data found in storage");
        Alert.alert("Error", "OTP session expired. Please request a new code.");
        setShowOTPInput(false);
        setEnteredOTP("");
        setGeneratedOTP(null);
        return;
      }

      const otpData = JSON.parse(storedOTPData);
      console.log("[OTP Verification] Parsed OTP data:", JSON.stringify(otpData, null, 2));
      console.log("[OTP Verification] Stored code:", otpData.code);
      console.log("[OTP Verification] Current time:", Date.now());
      console.log("[OTP Verification] Expires at:", otpData.expiresAt);
      console.log("[OTP Verification] Time remaining (ms):", otpData.expiresAt - Date.now());
      
      // Check if OTP has expired
      if (Date.now() > otpData.expiresAt) {
        console.log("[OTP Verification] Error: OTP has expired");
        Alert.alert("Expired", "The verification code has expired. Please request a new code.");
        await AsyncStorage.removeItem("resetOTP");
        setShowOTPInput(false);
        setEnteredOTP("");
        setGeneratedOTP(null);
        return;
      }

      // Verify the entered OTP matches the stored OTP
      const enteredOTPTrimmed = enteredOTP.trim();
      const storedCode = otpData.code;
      console.log("[OTP Verification] Comparing codes:");
      console.log("[OTP Verification]   Entered (trimmed):", enteredOTPTrimmed);
      console.log("[OTP Verification]   Stored code:", storedCode);
      console.log("[OTP Verification]   Match:", enteredOTPTrimmed === storedCode);
      
      if (enteredOTPTrimmed === storedCode) {
        console.log("[OTP Verification] SUCCESS: OTP verified correctly!");
        // OTP verified successfully
        Alert.alert(
          "Verification Successful",
          "Your code has been verified. You can now reset your password.",
          [
            {
              text: "OK",
              onPress: () => {
                console.log("[OTP Verification] Clearing OTP data and resetting states");
                // Clear OTP data
                AsyncStorage.removeItem("resetOTP");
                // Reset states
                setShowOTPInput(false);
                setEnteredOTP("");
                setPhoneNumber("");
                setGeneratedOTP(null);
                setIsForgotOpen(false);
                console.log("[OTP Verification] All states reset, modal closed");
                // TODO: Navigate to password reset screen or show password reset form
                // For now, just close the modal
              }
            }
          ]
        );
      } else {
        console.log("[OTP Verification] FAILED: Codes do not match");
        Alert.alert("Invalid Code", "The code you entered is incorrect. Please try again.");
        setEnteredOTP("");
      }
    } catch (error: any) {
      console.error("[OTP Verification] Error:", error);
      console.error("[OTP Verification] Error details:", JSON.stringify(error, null, 2));
      Alert.alert("Error", "Failed to verify code. Please try again.");
    } finally {
      setIsVerifying(false);
      console.log("[OTP Verification] isVerifying set to false");
    }
  };

  const handleResendCode = async () => {
    console.log("[OTP] handleResendCode called");
    // Reset OTP input view
    setShowOTPInput(false);
    setEnteredOTP("");
    setGeneratedOTP(null);
    console.log("[OTP] Resend: Reset OTP input view and cleared states");
    // Resend the code
    await handleSendResetCode();
  };

  const handleCloseModal = () => {
    console.log("[OTP] handleCloseModal called - resetting all states");
    setIsForgotOpen(false);
    setShowOTPInput(false);
    setPhoneNumber("");
    setEnteredOTP("");
    setGeneratedOTP(null);
    setIsSendingCode(false);
    setIsVerifying(false);
    console.log("[OTP] All states reset");
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={[styles.card, { backgroundColor: theme.card, ...theme.elevation }]}>
          <Text style={[styles.title, { color: theme.secondary }]}>Welcome to PILLNOW</Text>
          <TextInput
            style={[styles.input, { 
              backgroundColor: theme.background,
              borderColor: theme.border,
              color: theme.text
            }]}
            placeholder="Email"
            placeholderTextColor={theme.textSecondary}
            value={email}
            onChangeText={setEmail}
          />
          <TextInput
            style={[styles.input, { 
              backgroundColor: theme.background,
              borderColor: theme.border,
              color: theme.text
            }]}
            placeholder="Password"
            placeholderTextColor={theme.textSecondary}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />

          <TouchableOpacity 
            style={styles.forgotButton}
            onPress={() => {
              console.log("[OTP] Forgot password button clicked - opening modal");
              setIsForgotOpen(true);
            }}
          >
            <Text style={[styles.forgotText, { color: theme.primary }]}>Forgot password?</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={[styles.button, { backgroundColor: theme.primary }]}
            onPress={handleLogin}
            disabled={loading}
          >
            <Text style={styles.buttonText}>
              {loading ? "Logging in..." : "Login"}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={styles.registerButton}
            onPress={() => router.push("/Create")}
          >
            <Text style={[styles.registerText, { color: theme.primary }]}>
              Don't have an account? Register
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <Modal
        visible={isForgotOpen}
        transparent
        animationType="fade"
        onRequestClose={handleCloseModal}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: theme.card }]}>
            {!showOTPInput ? (
              // Phone Number Input Step
              <>
                <Text style={[styles.modalTitle, { color: theme.text }]}>Reset your password</Text>
                <Text style={[styles.modalSubtitle, { color: theme.textSecondary }]}>
                  Enter your contact number to receive a reset code via SMS.
                </Text>
                <TextInput
                  style={[styles.input, { 
                    backgroundColor: theme.background,
                    borderColor: theme.border,
                    color: theme.text
                  }]}
                  placeholder="Contact Number"
                  placeholderTextColor={theme.textSecondary}
                  value={phoneNumber}
                  onChangeText={setPhoneNumber}
                  keyboardType="phone-pad"
                  editable={!isSendingCode}
                />

                <View style={styles.modalActions}>
                  <TouchableOpacity
                    style={[styles.modalButton, { borderColor: theme.border }]}
                    onPress={handleCloseModal}
                    disabled={isSendingCode}
                  >
                    <Text style={[styles.modalButtonText, { color: theme.textSecondary }]}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalPrimaryButton, { backgroundColor: theme.primary }]}
                    onPress={handleSendResetCode}
                    disabled={isSendingCode}
                  >
                    {isSendingCode ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text style={styles.modalPrimaryButtonText}>Send Code</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              // OTP Verification Step
              <>
                <Text style={[styles.modalTitle, { color: theme.text }]}>Enter Verification Code</Text>
                <Text style={[styles.modalSubtitle, { color: theme.textSecondary }]}>
                  We've sent a 6-digit code to {phoneNumber}. Please enter it below.
                </Text>
                <TextInput
                  style={[styles.input, { 
                    backgroundColor: theme.background,
                    borderColor: theme.border,
                    color: theme.text,
                    textAlign: "center",
                    fontSize: 20,
                    letterSpacing: 8,
                    fontWeight: "bold"
                  }]}
                  placeholder="000000"
                  placeholderTextColor={theme.textSecondary}
                  value={enteredOTP}
                  onChangeText={(text) => {
                    // Only allow numbers and limit to 6 digits
                    const numericText = text.replace(/[^0-9]/g, "").slice(0, 6);
                    console.log("[OTP Input] Text changed:", text, "-> Filtered:", numericText);
                    setEnteredOTP(numericText);
                  }}
                  keyboardType="number-pad"
                  maxLength={6}
                  editable={!isVerifying}
                />

                <TouchableOpacity
                  style={styles.resendButton}
                  onPress={handleResendCode}
                  disabled={isSendingCode || isVerifying}
                >
                  {isSendingCode ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <ActivityIndicator size="small" color={theme.primary} />
                      <Text style={[styles.resendText, { color: theme.primary }]}>
                        Sending...
                      </Text>
                    </View>
                  ) : (
                    <Text style={[styles.resendText, { color: theme.primary }]}>
                      Didn't receive the code? Resend
                    </Text>
                  )}
                </TouchableOpacity>

                <View style={styles.modalActions}>
                  <TouchableOpacity
                    style={[styles.modalButton, { borderColor: theme.border }]}
                    onPress={() => {
                      console.log("[OTP] Back button clicked - returning to phone input");
                      setShowOTPInput(false);
                      setEnteredOTP("");
                    }}
                    disabled={isVerifying}
                  >
                    <Text style={[styles.modalButtonText, { color: theme.textSecondary }]}>Back</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalPrimaryButton, { backgroundColor: theme.primary }]}
                    onPress={handleVerifyOTP}
                    disabled={isVerifying || enteredOTP.length !== 6}
                  >
                    {isVerifying ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text style={styles.modalPrimaryButtonText}>Verify</Text>
                    )}
                  </TouchableOpacity>
                </View>
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
  scrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    padding: 20,
  },
  card: {
    borderRadius: 30,
    padding: 40,
    elevation: 8,
    alignItems: "center",
    width: "100%",
  },
  title: {
    fontSize: 26,
    fontWeight: "bold",
    marginBottom: 25,
    textAlign: "center",
  },
  input: { 
    width: "100%",
    height: 55,
    borderWidth: 1.5,
    borderRadius: 12,
    paddingLeft: 18,
    marginBottom: 18,
    fontSize: 16,
  },
  button: {
    paddingVertical: 15,
    borderRadius: 12,
    width: "100%",
    alignItems: "center",
    marginTop: 15,
  },
  buttonText: {
    fontSize: 18,
    color: "white",
    fontWeight: "bold",
  },
  forgotButton: {
    alignSelf: "flex-end",
    marginTop: -8,
    marginBottom: 10,
  },
  forgotText: {
    fontSize: 14,
    fontWeight: "600",
  },
  registerButton: {
    marginTop: 20,
  },
  registerText: {
    fontSize: 16,
    fontWeight: "bold",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  modalCard: {
    width: "100%",
    borderRadius: 16,
    padding: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 6,
    textAlign: "center",
  },
  modalSubtitle: {
    fontSize: 14,
    marginBottom: 16,
    textAlign: "center",
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 12,
  },
  modalButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    backgroundColor: "transparent",
    marginRight: 8,
  },
  modalButtonText: {
    fontSize: 14,
    fontWeight: "600",
  },
  modalPrimaryButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
  },
  modalPrimaryButtonText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#fff",
  },
  resendButton: {
    marginTop: 8,
    marginBottom: 16,
    alignItems: "center",
  },
  resendText: {
    fontSize: 14,
    fontWeight: "600",
  },
});

export default LoginScreen;
