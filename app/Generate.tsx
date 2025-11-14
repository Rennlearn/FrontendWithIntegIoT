import React, { useEffect } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

interface MedicationRow {
  _id: string;
  containerId: number;
  medicineName: string;
  scheduledTime: string;
  date: string;
  status: 'Taken' | 'Pending' | 'Missed';
}

const Generate = () => {
  const route = useRoute();
  const navigation = useNavigation();
  // Be defensive: params may be undefined depending on navigator
  const params = (route?.params as any) || {};
  const adherenceDataParam: string = typeof params.adherenceData === 'string' ? params.adherenceData : '[]';

  useEffect(() => {
    generatePDF();
  }, []);

  const generatePDF = async () => {
    try {
      const data: MedicationRow[] = JSON.parse(adherenceDataParam || '[]');
      const total = data.length;
      const taken = data.filter(d => d.status === 'Taken').length;
      const missed = data.filter(d => d.status === 'Missed').length;
      const pending = total - taken - missed;
      const adherencePct = total > 0 ? Math.round((taken / total) * 100) : 0;

      const html = `
        <html>
          <head>
            <style>
              body {
                font-family: Arial, sans-serif;
                padding: 20px;
              }
              h1 {
                color: #D14A99;
                text-align: center;
              }
              .summary { margin: 16px 0; padding: 12px; border: 1px solid #ddd; border-radius: 8px; }
              .container {
                margin-bottom: 20px;
                padding: 15px;
                border: 1px solid #ddd;
                border-radius: 5px;
              }
              .header {
                color: #4A90E2;
                font-weight: bold;
              }
              .status {
                color: #4CAF50;
              }
              .pending {
                color: #FFA500;
              }
              .missed {
                color: #E53935;
              }
            </style>
          </head>
          <body>
            <h1>Medication Adherence Report</h1>
            <p>Generated on: ${new Date().toLocaleString()}</p>
            <div class="summary">
              <p><strong>Total doses:</strong> ${total}</p>
              <p><strong>Taken:</strong> ${taken} (${adherencePct}%)</p>
              <p><strong>Missed:</strong> ${missed}</p>
              <p><strong>Pending:</strong> ${pending}</p>
            </div>
            ${data.map(med => `
              <div class="container">
                <h2 class="header">Container ${med.containerId}</h2>
                <p><strong>Medicine:</strong> ${med.medicineName}</p>
                <p><strong>Scheduled Time:</strong> ${med.scheduledTime}</p>
                <p><strong>Date:</strong> ${med.date}</p>
                <p><strong>Status:</strong> 
                  <span class="${med.status === 'Taken' ? 'status' : med.status === 'Missed' ? 'missed' : 'pending'}">
                    ${med.status}
                  </span>
                </p>
              </div>
            `).join('')}
          </body>
        </html>
      `;

      const { uri } = await Print.printToFileAsync({ html });
      await Sharing.shareAsync(uri, {
        mimeType: 'application/pdf',
        dialogTitle: 'Medication Adherence Report',
      });

      navigation.goBack();
    } catch (error) {
      Alert.alert('Error', 'Failed to generate PDF report');
      navigation.goBack();
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.text}>Generating PDF report...</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
  },
  text: {
    fontSize: 18,
    color: '#666666',
  },
});

export default Generate;
