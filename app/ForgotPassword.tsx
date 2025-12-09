import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import axios from "axios";
import { useTheme } from "@/context/ThemeContext";
import { lightTheme, darkTheme } from "@/styles/theme";

/**
 * ForgotPassword Screen
 * 
 * Flow:
 * 1. User enters phone number
 * 2. Backend sends OTP via SMS (using configured SMS service: HTTP/Serial/Queue)
 * 3. User enters OTP
 * 4. Backend verifies OTP
 * 5. User navigates to ResetPassword screen
 * 
 * Backend API Endpoints:
 * - POST /api/users/forgot-password { phone: string } → Sends OTP via SMS
 * - POST /api/users/verify-otp { phone: string, otp: string } → Verifies OTP
 */

const ForgotPassword = () => {
  const router = useRouter();
  const { isDarkMode } = useTheme();
  const theme = isDarkMode ? darkTheme : lightTheme;

  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [sendingOTP, setSendingOTP] = useState(false);
  const [verifyingOTP, setVerifyingOTP] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [otpVerified, setOtpVerified] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  // Send OTP to phone number
  const handleSendOTP = async () => {
    if (!phone.trim()) {
      Alert.alert("Error", "Please enter your phone number.");
      return;
    }

    // Basic phone number validation
    const phoneRegex = /^[+]?[(]?[0-9]{1,4}[)]?[-\s.]?[(]?[0-9]{1,4}[)]?[-\s.]?[0-9]{1,9}$/;
    if (!phoneRegex.test(phone.trim())) {
      Alert.alert("Error", "Please enter a valid phone number.");
      return;
    }

    setSendingOTP(true);
    try {
      const response = await axios.post(
        "https://pillnow-database.onrender.com/api/users/forgot-password",
        { phone: phone.trim() }
      );

      if (response.data && response.data.success) {
        setOtpSent(true);
        setResendCooldown(60); // 60 second cooldown
        
        // Start countdown timer
        const countdown = setInterval(() => {
          setResendCooldown((prev) => {
            if (prev <= 1) {
              clearInterval(countdown);
              return 0;
            }
            return prev - 1;
          });
        }, 1000);

        Alert.alert(
          "OTP Sent",
          `A verification code has been sent to ${phone.trim()}. Please check your messages and enter the code below.`
        );
      } else {
        Alert.alert(
          "Error",
          response.data?.message || "Failed to send OTP. Please try again."
        );
      }
    } catch (error: any) {
      console.error("Send OTP error:", error);
      const errorMessage =
        error.response?.data?.message ||
        error.message ||
        "Failed to send OTP. Please check your phone number and try again.";
      Alert.alert("Error", errorMessage);
    } finally {
      setSendingOTP(false);
    }
  };

  // Verify OTP
  const handleVerifyOTP = async () => {
    if (!otp.trim()) {
      Alert.alert("Error", "Please enter the verification code.");
      return;
    }

    if (otp.trim().length < 4) {
      Alert.alert("Error", "Please enter a valid verification code.");
      return;
    }

    setVerifyingOTP(true);
    try {
      const response = await axios.post(
        "https://pillnow-database.onrender.com/api/users/verify-otp",
        {
          phone: phone.trim(),
          otp: otp.trim(),
        }
      );

      if (response.data && response.data.success) {
        setOtpVerified(true);
        Alert.alert(
          "Verification Successful",
          "Your phone number has been verified. You can now reset your password.",
          [
            {
              text: "OK",
              onPress: () => {
                // Navigate to reset password screen with phone number
                router.push({
                  pathname: "/ResetPassword",
                  params: { 
                    phone: phone.trim(),
                    otpVerified: "true"
                  },
                });
              },
            },
          ]
        );
      } else {
        Alert.alert(
          "Invalid Code",
          response.data?.message || "The verification code is incorrect. Please try again."
        );
        setOtp("");
      }
    } catch (error: any) {
      console.error("Verify OTP error:", error);
      const errorMessage =
        error.response?.data?.message ||
        error.message ||
        "Failed to verify code. Please try again.";
      Alert.alert("Error", errorMessage);
      setOtp("");
    } finally {
      setVerifyingOTP(false);
    }
  };

  // Resend OTP
  const handleResendOTP = async () => {
    if (resendCooldown > 0) {
      Alert.alert(
        "Please Wait",
        `Please wait ${resendCooldown} seconds before requesting a new code.`
      );
      return;
    }
    await handleSendOTP();
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.background }]}
      contentContainerStyle={styles.contentContainer}
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <Ionicons name="arrow-back" size={24} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: theme.text }]}>
          Forgot Password
        </Text>
      </View>

      {/* Content */}
      <View style={[styles.card, { backgroundColor: theme.card }]}>
        <Ionicons
          name="lock-closed-outline"
          size={64}
          color={theme.primary}
          style={styles.icon}
        />
        <Text style={[styles.title, { color: theme.text }]}>
          Reset Your Password
        </Text>
        <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
          {!otpSent
            ? "Enter your phone number to receive a verification code."
            : otpVerified
            ? "Phone number verified. You can now reset your password."
            : "Enter the verification code sent to your phone number."}
        </Text>

        {/* Phone Number Input */}
        <View style={styles.inputContainer}>
          <Ionicons
            name="call-outline"
            size={20}
            color={theme.textSecondary}
            style={styles.inputIcon}
          />
          <TextInput
            style={[styles.input, { color: theme.text, borderColor: theme.border }]}
            placeholder="Enter your phone number"
            placeholderTextColor={theme.textSecondary}
            value={phone}
            onChangeText={(text) => {
              setPhone(text);
              // Reset OTP state if phone number changes
              if (otpSent) {
                setOtpSent(false);
                setOtpVerified(false);
                setOtp("");
              }
            }}
            keyboardType="phone-pad"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!otpSent || otpVerified}
          />
        </View>

        {/* Send OTP Button */}
        {!otpSent && (
          <TouchableOpacity
            style={[
              styles.submitButton,
              { backgroundColor: theme.primary },
              (sendingOTP || !phone.trim()) && styles.submitButtonDisabled,
            ]}
            onPress={handleSendOTP}
            disabled={sendingOTP || !phone.trim()}
          >
            {sendingOTP ? (
              <ActivityIndicator size="small" color={theme.card} />
            ) : (
              <Text style={[styles.submitButtonText, { color: theme.card }]}>
                Send Verification Code
              </Text>
            )}
          </TouchableOpacity>
        )}

        {/* OTP Input (shown after OTP is sent) */}
        {otpSent && !otpVerified && (
          <>
            <View style={styles.inputContainer}>
              <Ionicons
                name="keypad-outline"
                size={20}
                color={theme.textSecondary}
                style={styles.inputIcon}
              />
              <TextInput
                style={[styles.input, { color: theme.text, borderColor: theme.border }]}
                placeholder="Enter verification code"
                placeholderTextColor={theme.textSecondary}
                value={otp}
                onChangeText={setOtp}
                keyboardType="number-pad"
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={6}
              />
            </View>

            {/* Resend OTP */}
            <TouchableOpacity
              style={styles.resendButton}
              onPress={handleResendOTP}
              disabled={resendCooldown > 0}
            >
              <Text
                style={[
                  styles.resendText,
                  { color: resendCooldown > 0 ? theme.textSecondary : theme.primary },
                ]}
              >
                {resendCooldown > 0
                  ? `Resend code in ${resendCooldown}s`
                  : "Resend verification code"}
              </Text>
            </TouchableOpacity>

            {/* Verify OTP Button */}
            <TouchableOpacity
              style={[
                styles.submitButton,
                { backgroundColor: theme.primary },
                (verifyingOTP || !otp.trim()) && styles.submitButtonDisabled,
              ]}
              onPress={handleVerifyOTP}
              disabled={verifyingOTP || !otp.trim()}
            >
              {verifyingOTP ? (
                <ActivityIndicator size="small" color={theme.card} />
              ) : (
                <Text style={[styles.submitButtonText, { color: theme.card }]}>
                  Verify Code
                </Text>
              )}
            </TouchableOpacity>
          </>
        )}

        {/* Back to Login */}
        <TouchableOpacity
          style={styles.backToLoginButton}
          onPress={() => router.back()}
        >
          <Text style={[styles.backToLoginText, { color: theme.primary }]}>
            Back to Login
          </Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  contentContainer: {
    padding: 20,
    paddingTop: 60,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 30,
  },
  backButton: {
    padding: 8,
    marginRight: 10,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: "bold",
  },
  card: {
    borderRadius: 15,
    padding: 24,
    elevation: 3,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  icon: {
    alignSelf: "center",
    marginBottom: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: "bold",
    textAlign: "center",
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 14,
    textAlign: "center",
    marginBottom: 30,
    lineHeight: 20,
  },
  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 20,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 15,
    paddingVertical: 12,
  },
  inputIcon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    fontSize: 16,
  },
  submitButton: {
    padding: 15,
    borderRadius: 10,
    alignItems: "center",
    marginTop: 10,
    marginBottom: 20,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    fontSize: 16,
    fontWeight: "bold",
  },
  resendButton: {
    alignItems: "center",
    padding: 10,
    marginBottom: 10,
  },
  resendText: {
    fontSize: 14,
    fontWeight: "600",
  },
  backToLoginButton: {
    alignItems: "center",
    padding: 10,
  },
  backToLoginText: {
    fontSize: 14,
    fontWeight: "600",
  },
});

export default ForgotPassword;
