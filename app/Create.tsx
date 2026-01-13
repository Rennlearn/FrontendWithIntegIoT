import React, { useState } from "react";
import { 
  View, Text, TextInput, TouchableOpacity, Alert, StyleSheet, ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform, Modal 
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import axios from "axios";
import { useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "@/context/ThemeContext";
import { lightTheme, darkTheme } from "@/styles/theme";

const CreateScreen = () => {
    const [showPasswordReq, setShowPasswordReq] = useState(false);
  const navigation = useNavigation();
  const { isDarkMode } = useTheme();
  const theme = isDarkMode ? darkTheme : lightTheme;
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [selectedRole, setSelectedRole] = useState(2); // Default role to 2 (Elder)
  const [loading, setLoading] = useState(false);

  const roleLabel = (role: number) => {
    if (role === 1) return "Admin";
    if (role === 2) return "Elder";
    if (role === 3) return "Caregiver";
    return String(role);
  };

  const handleCreate = async () => {
    // Trim and normalize all inputs to prevent whitespace and case issues
    const trimmedName = name.trim();
    // CRITICAL: Email must be lowercased to match backend normalization
    // Backend stores emails in lowercase, so registration must also lowercase to ensure login works
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedPhone = phone.trim();
    const trimmedPassword = password.trim();

    if (!trimmedName || !trimmedEmail || !trimmedPhone || !trimmedPassword) {
      Alert.alert("Error", "All fields are required!");
      return;
    }

    // Password validation (on trimmed password)
    if (trimmedPassword.length < 8) {
      Alert.alert(
        "Invalid Password",
        "Password must be at least 8 characters long."
      );
      return;
    }
    if (!/\d/.test(trimmedPassword)) {
      Alert.alert(
        "Invalid Password",
        "Password must contain at least one number."
      );
      return;
    }

    try {
      setLoading(true);
      await AsyncStorage.removeItem("token"); // Clear old token before registration

      // CRITICAL: Send normalized (lowercased) email and trimmed password
      // Backend normalizes emails to lowercase, so registration must match to ensure login works
      const response = await axios.post("https://pillnow-database.onrender.com/api/users/register", {
        name: trimmedName,
        email: trimmedEmail,
        phone: trimmedPhone,
        password: trimmedPassword, // Trimmed password ensures no whitespace issues
        role: selectedRole
      });

      // Log successful registration for debugging
      console.log("[Create] Account created successfully:", {
        email: trimmedEmail,
        name: trimmedName,
        phone: trimmedPhone,
        role: selectedRole,
        responseData: response.data
      });

      Alert.alert("Success", "Account created successfully!");
      // Navigate to login screen after successful registration
      navigation.navigate("LoginScreen" as never);
    } catch (error: any) {
      // Enhanced error logging for debugging
      const errorMessage = error.response?.data?.message || error.message || "Something went wrong.";
      const statusCode = error.response?.status;
      
      console.error("[Create] Registration failed:", {
        email: trimmedEmail,
        error: errorMessage,
        status: statusCode,
        responseData: error.response?.data
      });

      Alert.alert("Registration Failed", errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleRoleSelect = (role: number) => {
    setSelectedRole(role);
  };

  return (
    <KeyboardAvoidingView 
      style={[styles.container, { backgroundColor: theme.background }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 20}
    >
      <ScrollView 
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={[styles.header, { backgroundColor: theme.card }]}>
          <TouchableOpacity 
            style={styles.backButton} 
            onPress={() => navigation.goBack()}
          >
            <Ionicons name="arrow-back" size={24} color={theme.text} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: theme.secondary }]}>Create Account</Text>
          <View style={{ width: 40 }} />
        </View>

        {/* Form Card */}
        <View style={[styles.card, { backgroundColor: theme.card }]}>
          <View style={styles.iconContainer}>
            <View style={[styles.iconCircle, { backgroundColor: theme.primary + '20' }]}>
              <Ionicons name="person-add" size={40} color={theme.primary} />
            </View>
          </View>

          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
            Join PILLNOW and start managing your medication schedule
          </Text>

          {/* Input Fields with Icons */}
          <View style={styles.inputWrapper}>
            <View style={[styles.inputContainer, { backgroundColor: theme.background, borderColor: theme.border }]}>
              <Ionicons name="person-outline" size={20} color={theme.textSecondary} style={styles.inputIcon} />
              <TextInput 
                placeholder="Full Name" 
                style={[styles.input, { color: theme.text }]} 
                value={name} 
                onChangeText={setName} 
                placeholderTextColor={theme.textSecondary}
              />
            </View>
          </View>

          <View style={styles.inputWrapper}>
            <View style={[styles.inputContainer, { backgroundColor: theme.background, borderColor: theme.border }]}>
              <Ionicons name="mail-outline" size={20} color={theme.textSecondary} style={styles.inputIcon} />
              <TextInput 
                placeholder="Email Address" 
                style={[styles.input, { color: theme.text }]} 
                value={email} 
                onChangeText={setEmail} 
                keyboardType="email-address"
                autoCapitalize="none"
                placeholderTextColor={theme.textSecondary}
              />
            </View>
          </View>

          <View style={styles.inputWrapper}>
            <View style={[styles.inputContainer, { backgroundColor: theme.background, borderColor: theme.border }]}>
              <Ionicons name="call-outline" size={20} color={theme.textSecondary} style={styles.inputIcon} />
              <TextInput 
                placeholder="Phone Number" 
                style={[styles.input, { color: theme.text }]} 
                value={phone} 
                onChangeText={setPhone} 
                keyboardType="phone-pad"
                placeholderTextColor={theme.textSecondary}
              />
            </View>
          </View>

          <View style={styles.inputWrapper}>
            <View style={[styles.inputContainer, { backgroundColor: theme.background, borderColor: theme.border }]}>
              <Ionicons name="lock-closed-outline" size={20} color={theme.textSecondary} style={styles.inputIcon} />
              <TextInput 
                placeholder="Password" 
                style={[styles.input, { color: theme.text }]} 
                value={password} 
                onChangeText={setPassword} 
                secureTextEntry 
                placeholderTextColor={theme.textSecondary}
                onFocus={() => setShowPasswordReq(true)}
                onBlur={() => setShowPasswordReq(false)}
              />
            </View>
          </View>

          {/* Role Selection */}
          <Text style={[styles.roleLabel, { color: theme.text }]}>Select Your Role</Text>
          <View style={styles.roleContainer}>
            <TouchableOpacity 
              style={[
                styles.roleButton, 
                { backgroundColor: theme.background, borderColor: theme.border },
                selectedRole === 2 && [styles.selectedRoleButton, { backgroundColor: theme.primary, borderColor: theme.primary }]
              ]} 
              onPress={() => handleRoleSelect(2)}
            >
              <Ionicons 
                name="person-circle-outline" 
                size={28} 
                color={selectedRole === 2 ? theme.card : theme.textSecondary} 
                style={styles.roleIcon}
              />
              <Text style={[
                styles.roleButtonText, 
                { color: selectedRole === 2 ? theme.card : theme.text },
                selectedRole === 2 && styles.selectedRoleButtonText
              ]}>
                Elder
              </Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={[
                styles.roleButton, 
                { backgroundColor: theme.background, borderColor: theme.border },
                selectedRole === 3 && [styles.selectedRoleButton, { backgroundColor: theme.primary, borderColor: theme.primary }]
              ]} 
              onPress={() => handleRoleSelect(3)}
            >
              <Ionicons 
                name="heart-outline" 
                size={28} 
                color={selectedRole === 3 ? theme.card : theme.textSecondary} 
                style={styles.roleIcon}
              />
              <Text style={[
                styles.roleButtonText, 
                { color: selectedRole === 3 ? theme.card : theme.text },
                selectedRole === 3 && styles.selectedRoleButtonText
              ]}>
                Caregiver
              </Text>
            </TouchableOpacity>
          </View>

          {/* Inline password requirements (shown under the password box, in red) */}
          {showPasswordReq && (
            <View style={{ marginTop: -6, marginBottom: 10, paddingHorizontal: 6 }}>
              <Text style={{ color: theme.error, fontWeight: '700', fontSize: 12 }}>
                Password Requirements
              </Text>
              <Text style={{ color: theme.error, marginTop: 4, fontSize: 12 }}>• At least 8 characters</Text>
              <Text style={{ color: theme.error, fontSize: 12 }}>• Must contain at least one number</Text>
            </View>
          )}
          {/* Register Button */}
          <TouchableOpacity 
            style={[styles.button, { backgroundColor: theme.primary }]} 
            onPress={handleCreate} 
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator color={theme.card} />
            ) : (
              <>
                <Text style={[styles.buttonText, { color: theme.card }]}>Create Account</Text>
                <Ionicons name="arrow-forward" size={20} color={theme.card} style={{ marginLeft: 8 }} />
              </>
            )}
          </TouchableOpacity>

          {/* Login Link */}
          <TouchableOpacity 
            style={styles.loginLink}
            onPress={() => navigation.navigate("LoginScreen" as never)}
          >
            <Text style={[styles.loginLinkText, { color: theme.textSecondary }]}>
              Already have an account?{" "}
              <Text style={[styles.loginLinkBold, { color: theme.primary }]}>Sign In</Text>
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: 30,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: Platform.OS === "ios" ? 60 : 40,
    paddingBottom: 20,
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  backButton: {
    padding: 8,
    borderRadius: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    flex: 1,
    textAlign: "center",
  },
  card: {
    flex: 1,
    marginTop: 20,
    marginHorizontal: 20,
    borderRadius: 24,
    padding: 24,
    elevation: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
  },
  iconContainer: {
    alignItems: "center",
    marginBottom: 16,
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: "center",
    alignItems: "center",
  },
  subtitle: {
    fontSize: 14,
    textAlign: "center",
    marginBottom: 32,
    lineHeight: 20,
  },
  inputWrapper: {
    marginBottom: 16,
  },
  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1.5,
    borderRadius: 16,
    paddingHorizontal: 16,
    height: 56,
  },
  inputIcon: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 0,
  },
  roleLabel: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 12,
    marginTop: 8,
  },
  roleContainer: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 24,
  },
  roleButton: {
    flex: 1,
    paddingVertical: 20,
    paddingHorizontal: 16,
    borderWidth: 2,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 100,
  },
  selectedRoleButton: {
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  roleIcon: {
    marginBottom: 8,
  },
  roleButtonText: {
    fontSize: 16,
    fontWeight: "600",
  },
  selectedRoleButtonText: {
    fontWeight: "bold",
  },
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 18,
    borderRadius: 16,
    marginTop: 8,
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  buttonText: {
    fontSize: 18,
    fontWeight: "bold",
  },
  loginLink: {
    marginTop: 24,
    alignItems: "center",
  },
  loginLinkText: {
    fontSize: 14,
  },
  loginLinkBold: {
    fontWeight: "bold",
  },
});

export default CreateScreen;
