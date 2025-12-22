import React, { useState, useEffect } from 'react';
import { Text, View } from "react-native";
import { createDrawerNavigator } from '@react-navigation/drawer';
import { NavigationContainer } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import LoginScreen from './LoginScreen';
import FlashScreen from './FlashScreen';
import BluetoothConnectionScreen from './BluetoothConnectionScreen';

const Drawer = createDrawerNavigator();

export default function Index() {
  const [token, setToken] = useState<string | null>(null);
  const [showFlash, setShowFlash] = useState(true);

  useEffect(() => {
    const checkToken = async () => {
      const storedToken = await AsyncStorage.getItem('token');
      setToken(storedToken);
    };
    checkToken();

    // Hide flash screen after 3 seconds
    const timer = setTimeout(() => {
      setShowFlash(false);
    }, 3000);

    return () => clearTimeout(timer);
  }, []);

  if (showFlash) {
    return <FlashScreen />;
  }

  return (
    <Drawer.Navigator>
      <Drawer.Screen name="BluetoothConnection" component={BluetoothConnectionScreen} />
      <Drawer.Screen name="Login" component={LoginScreen} />
    </Drawer.Navigator>
  );
}
