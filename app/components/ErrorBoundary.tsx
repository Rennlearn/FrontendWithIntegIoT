import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

type Props = {
  children: React.ReactNode;
};

type State = {
  hasError: boolean;
  message?: string;
};

/**
 * Prevents "white screen" on render-time crashes by showing a fallback UI.
 * This does NOT catch async promise errors; it catches render/lifecycle errors.
 */
export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: any): State {
    return { hasError: true, message: String(error?.message || error) };
  }

  componentDidCatch(error: any, info: any) {
    // Keep logs high-signal (shows up in Metro/Logcat)
    console.error('[ErrorBoundary] Unhandled render error:', error, info);
  }

  private handleReset = () => {
    this.setState({ hasError: false, message: undefined });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <View style={styles.container}>
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.subtitle}>
          The app hit an unexpected error. This screen prevents a blank white screen.
        </Text>
        {this.state.message ? <Text style={styles.msg}>{this.state.message}</Text> : null}
        <TouchableOpacity style={styles.btn} onPress={this.handleReset}>
          <Text style={styles.btnText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
    backgroundColor: '#0b0f17',
  },
  title: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 10,
  },
  subtitle: {
    color: '#cbd5e1',
    fontSize: 14,
    marginBottom: 12,
  },
  msg: {
    color: '#fca5a5',
    fontSize: 12,
    marginBottom: 18,
  },
  btn: {
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#2563eb',
  },
  btnText: {
    color: '#ffffff',
    fontWeight: '700',
  },
});


