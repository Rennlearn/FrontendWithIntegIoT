import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  ScrollView,
  Modal,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import axios from "axios";
import { useTheme } from "@/context/ThemeContext";
import { lightTheme, darkTheme } from "@/styles/theme";

/**
 * ResetPassword Screen
 * 
 * Flow:
 * 1. Requires OTP verification (from ForgotPassword screen)
 * 2. User enters new password
 * 3. Backend resets password using email to find account
 * 
 * Backend API Endpoints:
 * - POST /api/users/reset-password { email: string, newPassword: string } → Resets password
 * 
 * Note: Email is used to find the account, not a reset token
 */

const ResetPassword = () => {
    const [showPasswordReq, setShowPasswordReq] = useState(false);
  const router = useRouter();
  const params = useLocalSearchParams();
  const { isDarkMode } = useTheme();
  const theme = isDarkMode ? darkTheme : lightTheme;

  const [email, setEmail] = useState((params.email as string) || "");
  const [otpVerified, setOtpVerified] = useState(params.otpVerified === "true");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // If email and OTP verification status are passed, use them
    if (params.email) {
      setEmail(params.email as string);
    }
    if (params.otpVerified === "true") {
      setOtpVerified(true);
    }

    // If OTP is not verified, redirect back to forgot password
    if (!params.otpVerified || params.otpVerified !== "true") {
      Alert.alert(
        "Verification Required",
        "Please verify your email first before resetting your password.",
        [
          {
            text: "OK",
            onPress: () => {
              router.replace("/ForgotPassword");
            },
          },
        ]
      );
    }
  }, [params]);

  const handleSubmit = async () => {
    // Validate email
    if (!email.trim()) {
      Alert.alert("Error", "Email is missing. Please start over.");
      router.replace("/ForgotPassword");
      return;
    }

    // Validate OTP verification
    if (!otpVerified) {
      Alert.alert(
        "Verification Required",
        "Please verify your email first before resetting your password.",
        [
          {
            text: "OK",
            onPress: () => {
              router.replace("/ForgotPassword");
            },
          },
        ]
      );
      return;
    }

    if (!newPassword.trim()) {
      Alert.alert("Error", "Please enter a new password.");
      return;
    }
    if (newPassword.length < 8) {
      Alert.alert("Error", "Password must be at least 8 characters long.");
      return;
    }
    if (!/\d/.test(newPassword)) {
      Alert.alert("Error", "Password must contain at least one number.");
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert("Error", "Passwords do not match. Please try again.");
      return;
    }

    setLoading(true);
    try {
      // Use email to find and reset the account password
      const response = await axios.post(
        "https://pillnow-database.onrender.com/api/users/reset-password",
        {
          email: email.trim(),
          newPassword: newPassword.trim(),
        }
      );

      if (response.data && response.data.success) {
        Alert.alert(
          "Success",
          "Your password has been reset successfully. You can now login with your new password.",
          [
            {
              text: "OK",
              onPress: () => {
                router.replace("/LoginScreen");
              },
            },
          ]
        );
      } else {
        Alert.alert(
          "Error",
          response.data?.message || "Failed to reset password. Please try again."
        );
      }
    } catch (error: any) {
      console.error("Reset password error:", error);
      const errorMessage =
        error.response?.data?.message ||
        error.message ||
        "Failed to reset password. The email may be invalid or the account may not exist. Please try again.";
      Alert.alert("Error", errorMessage);
    } finally {
      setLoading(false);
    }
  };

  // If OTP is not verified, show message
  if (!otpVerified) {
    return (
      <ScrollView
        style={[styles.container, { backgroundColor: theme.background }]}
        contentContainerStyle={styles.contentContainer}
      >
        <View style={[styles.card, { backgroundColor: theme.card }]}>
          <Ionicons
            name="alert-circle-outline"
            size={64}
            color={theme.warning}
            style={styles.icon}
          />
          <Text style={[styles.title, { color: theme.text }]}>
            Verification Required
          </Text>
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
            Please verify your email first before resetting your password.
          </Text>
          <TouchableOpacity
            style={[styles.submitButton, { backgroundColor: theme.primary }]}
            onPress={() => router.replace("/ForgotPassword")}
          >
            <Text style={[styles.submitButtonText, { color: theme.card }]}>
              Go to Verification
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  }

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
          Reset Password
        </Text>
      </View>

      {/* Content */}
      <View style={[styles.card, { backgroundColor: theme.card }]}>
        <Ionicons
          name="key-outline"
          size={64}
          color={theme.primary}
          style={styles.icon}
        />
        <Text style={[styles.title, { color: theme.text }]}>
          Create New Password
        </Text>
        <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
          Enter your new password below. Make sure it's at least 6 characters long.
        </Text>

        {/* Email Display (read-only) */}
        <View style={[styles.inputContainer, { backgroundColor: theme.background }]}>
          <Ionicons
            name="mail-outline"
            size={20}
            color={theme.textSecondary}
            style={styles.inputIcon}
          />
          <Text style={[styles.emailDisplay, { color: theme.textSecondary }]}>
            {email || "Email"}
          </Text>
          <Ionicons
            name="checkmark-circle"
            size={20}
            color={theme.success}
            style={styles.verifiedIcon}
          />
        </View>

        {/* New Password Input */}
        <View style={styles.inputContainer}>
          <Ionicons
            name="lock-closed-outline"
            size={20}
            color={theme.textSecondary}
            style={styles.inputIcon}
          />
          <TextInput
            style={[styles.input, { color: theme.text, borderColor: theme.border }]}
            placeholder="New Password"
            placeholderTextColor={theme.textSecondary}
            value={newPassword}
            onChangeText={setNewPassword}
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            autoCorrect={false}
            onFocus={() => setShowPasswordReq(true)}
            onBlur={() => setShowPasswordReq(false)}
          />
        {/* Password requirements popup */}
        <Modal
          visible={showPasswordReq}
          transparent
          animationType="fade"
        >
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#00000080' }}>
            <View style={{ backgroundColor: theme.card, padding: 20, borderRadius: 10, elevation: 5 }}>
              <Text style={{ color: theme.text, fontWeight: 'bold', fontSize: 16 }}>Password Requirements</Text>
              <Text style={{ color: theme.text, marginTop: 10 }}>• At least 8 characters</Text>
              <Text style={{ color: theme.text }}>• Must contain at least one number</Text>
              <TouchableOpacity style={{ marginTop: 15, alignSelf: 'flex-end' }} onPress={() => setShowPasswordReq(false)}>
                <Text style={{ color: theme.primary }}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
          <TouchableOpacity
            onPress={() => setShowPassword(!showPassword)}
            style={styles.eyeIcon}
          >
            <Ionicons
              name={showPassword ? "eye-outline" : "eye-off-outline"}
              size={20}
              color={theme.textSecondary}
            />
          </TouchableOpacity>
        </View>

        {/* Confirm Password Input */}
        <View style={styles.inputContainer}>
          <Ionicons
            name="lock-closed-outline"
            size={20}
            color={theme.textSecondary}
            style={styles.inputIcon}
          />
          <TextInput
            style={[styles.input, { color: theme.text, borderColor: theme.border }]}
            placeholder="Confirm New Password"
            placeholderTextColor={theme.textSecondary}
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry={!showConfirmPassword}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TouchableOpacity
            onPress={() => setShowConfirmPassword(!showConfirmPassword)}
            style={styles.eyeIcon}
          >
            <Ionicons
              name={showConfirmPassword ? "eye-outline" : "eye-off-outline"}
              size={20}
              color={theme.textSecondary}
            />
          </TouchableOpacity>
        </View>

        {/* Password Requirements */}
        <View style={styles.requirementsContainer}>
          <Text style={[styles.requirementsTitle, { color: theme.textSecondary }]}>
            Password Requirements:
          </Text>
          <View style={styles.requirementItem}>
            <Ionicons
              name={newPassword.length >= 6 ? "checkmark-circle" : "ellipse-outline"}
              size={16}
              color={newPassword.length >= 6 ? theme.success : theme.textSecondary}
            />
            <Text
              style={[
                styles.requirementText,
                {
                  color:
                    newPassword.length >= 6 ? theme.success : theme.textSecondary,
                },
              ]}
            >
              At least 6 characters
            </Text>
          </View>
          <View style={styles.requirementItem}>
            <Ionicons
              name={newPassword === confirmPassword && newPassword.length > 0 ? "checkmark-circle" : "ellipse-outline"}
              size={16}
              color={
                newPassword === confirmPassword && newPassword.length > 0
                  ? theme.success
                  : theme.textSecondary
              }
            />
            <Text
              style={[
                styles.requirementText,
                {
                  color:
                    newPassword === confirmPassword && newPassword.length > 0
                      ? theme.success
                      : theme.textSecondary,
                },
              ]}
            >
              Passwords match
            </Text>
          </View>
        </View>

        {/* Submit Button */}
        <TouchableOpacity
          style={[
            styles.submitButton,
            { backgroundColor: theme.primary },
            loading && styles.submitButtonDisabled,
          ]}
          onPress={handleSubmit}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator size="small" color={theme.card} />
          ) : (
            <Text style={[styles.submitButtonText, { color: theme.card }]}>
              Reset Password
            </Text>
          )}
        </TouchableOpacity>

        {/* Back to Login */}
        <TouchableOpacity
          style={styles.backToLoginButton}
          onPress={() => router.replace("/LoginScreen")}
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
  emailDisplay: {
    flex: 1,
    fontSize: 16,
  },
  verifiedIcon: {
    marginLeft: 10,
  },
  eyeIcon: {
    padding: 5,
  },
  requirementsContainer: {
    marginBottom: 20,
    padding: 15,
    borderRadius: 10,
    backgroundColor: "rgba(0,0,0,0.03)",
  },
  requirementsTitle: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 10,
  },
  requirementItem: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  requirementText: {
    fontSize: 13,
    marginLeft: 8,
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
  backToLoginButton: {
    alignItems: "center",
    padding: 10,
  },
  backToLoginText: {
    fontSize: 14,
    fontWeight: "600",
  },
});

export default ResetPassword;
