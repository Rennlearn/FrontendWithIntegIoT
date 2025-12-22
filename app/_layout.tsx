import { Stack } from "expo-router";
import { ThemeProvider } from "@/context/ThemeContext";
import ErrorBoundary from "./components/ErrorBoundary";
import GlobalAlarmHandler from "./components/GlobalAlarmHandler";

export default function RootLayout() {
  return (
    <ThemeProvider>
      <ErrorBoundary>
        {/* Mount global BT alarm handler once so alarms/mismatch modals work on every screen */}
        <GlobalAlarmHandler />
        <Stack screenOptions={{ headerShown: false }} />
      </ErrorBoundary>
    </ThemeProvider>
  );
}
