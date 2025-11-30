import React, { useState, useEffect, useCallback } from "react";
import { View, Text, ActivityIndicator, StyleSheet, TouchableOpacity } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useNavigation, NavigationProp, ParamListBase } from "@react-navigation/native";
import { jwtDecode } from "jwt-decode";

interface DecodedToken {
  id: string;
}

interface UserData extends Partial<DecodedToken> {
  fullname: string;
  username: string;
  email?: string;
}

const maskEmail = (email: string): string => {
  if (!email) return "";

  const [localPart, domain] = email.split("@");
  if (!domain) return email;

  const visibleLocalChars = Math.min(2, localPart.length);
  const maskedLocal =
    localPart.substring(0, visibleLocalChars) +
    "*".repeat(Math.max(3, localPart.length - visibleLocalChars));

  const [domainName, ...tldParts] = domain.split(".");
  const visibleDomainChars = Math.min(2, domainName.length);
  const maskedDomain =
    domainName.substring(0, visibleDomainChars) +
    "*".repeat(Math.max(2, domainName.length - visibleDomainChars));

  const tld = tldParts.join(".");
  return `${maskedLocal}@${maskedDomain}${tld ? "." + tld : ""}`;
};

const UserProfile: React.FC = () => {
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const [userData, setUserData] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const redirectToLogin = useCallback(() => {
    console.warn("Session expired. Redirecting to login.");
    navigation.reset({ index: 0, routes: [{ name: "LoginScreen" }] });
  }, [navigation]);

  const fetchUserProfile = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);

    try {
      const token = await AsyncStorage.getItem("token");
      if (!token) {
        redirectToLogin();
        return;
      }

      const sanitizedToken = token.trim();
      const decodedToken = jwtDecode<DecodedToken>(sanitizedToken);
      const userId = decodedToken.id;

      const response = await fetch(`https://devapi-618v.onrender.com/api/user/${userId}`, {
        method: "GET",
        headers: {
          Authorization: sanitizedToken,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      });

      const data = await response.json();
      if (response.ok) {
        setUserData(data);
        return;
      } else {
        const apiError = data?.error ?? "Failed to fetch user data.";
        setErrorMessage(apiError);

        if (apiError === "Invalid token") {
          await AsyncStorage.removeItem("token");
          redirectToLogin();
        }
      }
    } catch (error) {
      console.error("Error fetching profile:", error);
      setErrorMessage("Something went wrong while loading your profile.");
    } finally {
      setLoading(false);
    }
  }, [redirectToLogin]);

  useEffect(() => {
    fetchUserProfile();
  }, [fetchUserProfile]);

  return (
    <View style={styles.container}>
      {loading ? (
        <ActivityIndicator size="large" color="#007BFF" />
      ) : userData ? (
        <View style={styles.profileCard}>
          <Text style={styles.greeting}>👋 Hello, {userData.fullname}!</Text>
          <Text style={styles.info}>Username: {userData.username}</Text>
          {userData.email ? (
            <Text style={styles.info}>Email: {maskEmail(userData.email)}</Text>
          ) : null}
          <TouchableOpacity 
            style={[styles.button, loading && styles.buttonDisabled]} 
            onPress={() => navigation.goBack()}
            disabled={loading}
            activeOpacity={loading ? 1 : 0.7}
          >
            <Text style={[styles.buttonText, loading && styles.buttonTextDisabled]}>⬅ Go Back</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <Text style={styles.errorText}>
          {errorMessage ?? "⚠️ Oops! We couldn't load your profile."}
        </Text>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#E3F2FD",
  },
  profileCard: {
    backgroundColor: "#FFFFFF",
    padding: 20,
    borderRadius: 10,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
    alignItems: "center",
  },
  greeting: {
    fontSize: 22,
    fontWeight: "bold",
    color: "#007BFF",
    marginBottom: 10,
  },
  info: {
    fontSize: 16,
    color: "#333",
  },
  button: {
    marginTop: 15,
    backgroundColor: "#007BFF",
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 5,
  },
  buttonText: {
    fontSize: 16,
    color: "#FFFFFF",
    fontWeight: "bold",
  },
  buttonDisabled: {
    backgroundColor: "#CCCCCC",
    opacity: 0.6,
  },
  buttonTextDisabled: {
    color: "#999999",
  },
  errorText: {
    fontSize: 16,
    color: "red",
  },
});

export default UserProfile;
