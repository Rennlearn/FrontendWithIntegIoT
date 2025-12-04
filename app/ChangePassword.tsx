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
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useTheme } from "./context/ThemeContext";
import { lightTheme, darkTheme } from "./styles/theme";

const ChangePassword = () => {
  const router = useRouter();
  const { isDarkMode } = useTheme();
  const theme = isDarkMode ? darkTheme : lightTheme;

  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showOldPassword, setShowOldPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!oldPassword.trim()) {
      Alert.alert("Error", "Please enter your current password.");
      return;
    }

    if (!newPassword.trim()) {
      Alert.alert("Error", "Please enter a new password.");
      return;
    }

    if (newPassword.length < 6) {
      Alert.alert("Error", "New password must be at least 6 characters long.");
      return;
    }

    if (oldPassword === newPassword) {
      Alert.alert("Error", "New password must be different from your current password.");
      return;
    }

    if (newPassword !== confirmPassword) {
      Alert.alert("Error", "New passwords do not match. Please try again.");
      return;
    }

    setLoading(true);
    try {
      const token = await AsyncStorage.getItem("token");
      if (!token) {
        Alert.alert("Error", "You must be logged in to change your password.");
        router.replace("/LoginScreen");
        return;
      }

      const response = await axios.post(
        "https://pillnow-database.onrender.com/api/users/change-password",
        {
          oldPassword: oldPassword.trim(),
          newPassword: newPassword.trim(),
        },
        {
          headers: {
            Authorization: `Bearer ${token.trim()}`,
            "Content-Type": "application/json",
          },
        }
      );

      Alert.alert(
        "Success",
        "Your password has been changed successfully.",
        [
          {
            text: "OK",
            onPress: () => {
              // Clear password fields
              setOldPassword("");
              setNewPassword("");
              setConfirmPassword("");
              router.back();
            },
          },
        ]
      );
    } catch (error: any) {
      console.error("Change password error:", error);
      const errorMessage =
        error.response?.data?.message ||
        error.message ||
        "Failed to change password. Please check your current password and try again.";
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
          Change Password
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
          Update Your Password
        </Text>
        <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
          Enter your current password and choose a new one.
        </Text>

        {/* Current Password Input */}
        <View style={styles.inputContainer}>
          <Ionicons
            name="lock-closed-outline"
            size={20}
            color={theme.textSecondary}
            style={styles.inputIcon}
          />
          <TextInput
            style={[styles.input, { color: theme.text, borderColor: theme.border }]}
            placeholder="Current Password"
            placeholderTextColor={theme.textSecondary}
            value={oldPassword}
            onChangeText={setOldPassword}
            secureTextEntry={!showOldPassword}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TouchableOpacity
            onPress={() => setShowOldPassword(!showOldPassword)}
            style={styles.eyeIcon}
          >
            <Ionicons
              name={showOldPassword ? "eye-outline" : "eye-off-outline"}
              size={20}
              color={theme.textSecondary}
            />
          </TouchableOpacity>
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
            secureTextEntry={!showNewPassword}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TouchableOpacity
            onPress={() => setShowNewPassword(!showNewPassword)}
            style={styles.eyeIcon}
          >
            <Ionicons
              name={showNewPassword ? "eye-outline" : "eye-off-outline"}
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
              name={oldPassword !== newPassword && newPassword.length > 0 ? "checkmark-circle" : "ellipse-outline"}
              size={16}
              color={
                oldPassword !== newPassword && newPassword.length > 0
                  ? theme.success
                  : theme.textSecondary
              }
            />
            <Text
              style={[
                styles.requirementText,
                {
                  color:
                    oldPassword !== newPassword && newPassword.length > 0
                      ? theme.success
                      : theme.textSecondary,
                },
              ]}
            >
              Different from current password
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
              Change Password
            </Text>
          )}
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
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    fontSize: 16,
    fontWeight: "bold",
  },
});

export default ChangePassword;


