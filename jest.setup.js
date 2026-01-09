// Jest setup for React Native / Expo (mocks native modules used by screens)
/* eslint-env jest */

import mockAsyncStorage from '@react-native-async-storage/async-storage/jest/async-storage-mock';

jest.mock('@react-native-async-storage/async-storage', () => mockAsyncStorage);

// Expo Font + Vector Icons: avoid native font loading in Jest
jest.mock('expo-font', () => ({
  isLoaded: () => true,
  loadAsync: async () => {},
}));

jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  const { Text } = require('react-native');
  const Icon = (props) => React.createElement(Text, props, '');
  return { Ionicons: Icon };
});


