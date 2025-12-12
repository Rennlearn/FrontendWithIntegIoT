import { Stack } from "expo-router";
import { ThemeProvider } from "@/context/ThemeContext";
import { AlarmProvider } from "@/context/AlarmContext";
import GlobalAlarmModal from "@/components/GlobalAlarmModal";

export default function RootLayout() {
  return (
    <ThemeProvider>
      <AlarmProvider>
        <Stack screenOptions={{ headerShown: false }} />
        <GlobalAlarmModal />
      </AlarmProvider>
    </ThemeProvider>
  );
}
