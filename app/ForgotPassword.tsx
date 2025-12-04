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
import { useTheme } from "./context/ThemeContext";
import { lightTheme, darkTheme } from "./styles/theme";

const ForgotPassword = () => {
  const router = useRouter();
  const { isDarkMode } = useTheme();
  const theme = isDarkMode ? darkTheme : lightTheme;

  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [useEmail, setUseEmail] = useState(true);
  const [loading, setLoading] = useState(false);
  const [resetToken, setResetToken] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (useEmail && !email.trim()) {
      Alert.alert("Error", "Please enter your email address.");
      return;
    }

    if (!useEmail && !phone.trim()) {
      Alert.alert("Error", "Please enter your phone number.");
      return;
    }

    setLoading(true);
    try {
      const payload = useEmail ? { email: email.trim() } : { phone: phone.trim() };
      
      const response = await axios.post(
        "https://pillnow-database.onrender.com/api/users/forgot-password",
        payload
      );

      if (response.data && response.data.resetToken) {
        // Store the reset token and navigate to reset password screen
        setResetToken(response.data.resetToken);
        Alert.alert(
          "Reset Code Generated",
          "A password reset code has been generated. You will be redirected to reset your password.",
          [
            {
              text: "OK",
              onPress: () => {
                router.push({
                  pathname: "/ResetPassword",
                  params: { resetToken: response.data.resetToken },
                });
              },
            },
          ]
        );
      } else {
        Alert.alert(
          "Success",
          "If an account exists with this information, a password reset code has been sent."
        );
      }
    } catch (error: any) {
      console.error("Forgot password error:", error);
      const errorMessage =
        error.response?.data?.message ||
        error.message ||
        "Failed to process request. Please try again.";
      Alert.alert("Error", errorMessage);
    } finally {
      setLoading(false);
    }
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
          Enter your email or phone number to receive a password reset code.
        </Text>

        {/* Toggle between Email and Phone */}
        <View style={styles.toggleContainer}>
          <TouchableOpacity
            style={[
              styles.toggleButton,
              useEmail && { backgroundColor: theme.primary },
            ]}
            onPress={() => setUseEmail(true)}
          >
            <Text
              style={[
                styles.toggleText,
                { color: useEmail ? theme.card : theme.text },
              ]}
            >
              Email
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.toggleButton,
              !useEmail && { backgroundColor: theme.primary },
            ]}
            onPress={() => setUseEmail(false)}
          >
            <Text
              style={[
                styles.toggleText,
                { color: !useEmail ? theme.card : theme.text },
              ]}
            >
              Phone
            </Text>
          </TouchableOpacity>
        </View>

        {/* Email Input */}
        {useEmail ? (
          <View style={styles.inputContainer}>
            <Ionicons
              name="mail-outline"
              size={20}
              color={theme.textSecondary}
              style={styles.inputIcon}
            />
            <TextInput
              style={[styles.input, { color: theme.text, borderColor: theme.border }]}
              placeholder="Enter your email"
              placeholderTextColor={theme.textSecondary}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
        ) : (
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
              onChangeText={setPhone}
              keyboardType="phone-pad"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
        )}

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
              Send Reset Code
            </Text>
          )}
        </TouchableOpacity>

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
  toggleContainer: {
    flexDirection: "row",
    marginBottom: 20,
    borderRadius: 10,
    backgroundColor: "rgba(0,0,0,0.05)",
    padding: 4,
  },
  toggleButton: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    alignItems: "center",
  },
  toggleText: {
    fontSize: 14,
    fontWeight: "600",
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


