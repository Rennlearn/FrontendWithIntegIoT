import { Stack } from "expo-router";
import { ThemeProvider } from "@/context/ThemeContext";
import ErrorBoundary from "./components/ErrorBoundary";
import GlobalAlarmHandler from "./components/GlobalAlarmHandler";
import { ModalManagerProvider } from "./components/ModalManager";

export default function RootLayout() {
  return (
    <ThemeProvider>
      <ErrorBoundary>
        <ModalManagerProvider>
          {/* Mount global BT alarm handler once so alarms/mismatch modals work on every screen */}
          <GlobalAlarmHandler />
          <Stack screenOptions={{ headerShown: false }} />
        </ModalManagerProvider>
      </ErrorBoundary>
    </ThemeProvider>
  );
}
