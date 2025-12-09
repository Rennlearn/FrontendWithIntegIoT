import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '@/context/ThemeContext';
import { lightTheme, darkTheme } from '@/styles/theme';

export default function LocationScreen() {
  const navigation = useNavigation();
  const { isDarkMode } = useTheme();
  const theme = isDarkMode ? darkTheme : lightTheme;

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: theme.card }]}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={30} color={theme.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: theme.secondary }]}>
          PILLBOX <Text style={[styles.highlight, { color: theme.primary }]}>TRACKING</Text>
        </Text>
      </View>

      {/* Sound Icon */}
      <View style={[styles.soundContainer, { backgroundColor: theme.card }]}>
        <Image source={require('@/assets/images/soundwave.png')} style={styles.soundIcon} />
      </View>

      {/* Play Sound Label */}
      <Text style={[styles.playSoundText, { color: theme.primary }]}>PLAY SOUND</Text>

      {/* Done Button */}
      <TouchableOpacity 
        style={[styles.doneButton, { backgroundColor: theme.primary }]} 
        onPress={() => navigation.goBack()}
      >
        <Text style={[styles.doneButtonText, { color: theme.card }]}>DONE</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    position: 'absolute',
    top: 40,
    left: 20,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    padding: 15,
    borderRadius: 15,
    elevation: 8,
  },
  backButton: {
    padding: 10,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    marginLeft: 10,
  },
  highlight: {
    color: '#4A90E2',
  },
  soundContainer: {
    padding: 20,
    borderRadius: 15,
    width: 150,
    height: 150,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    elevation: 3,
    alignSelf: 'center',
  },
  soundIcon: {
    width: 100,
    height: 100,
    resizeMode: 'contain',
  },
  playSoundText: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
  },
  doneButton: {
    paddingVertical: 12,
    paddingHorizontal: 40,
    borderRadius: 12,
    elevation: 3,
    alignSelf: 'center',
  },
  doneButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
  },
});

