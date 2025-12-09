import React from "react";
import { View, Text, Image, TouchableOpacity } from "react-native";
import { useNavigation } from "@react-navigation/native";
import styled from "styled-components/native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from '@/context/ThemeContext';
import { lightTheme, darkTheme } from '@/styles/theme';

const ModifySchedule = () => {
  const navigation = useNavigation();
  const { isDarkMode } = useTheme();
  const theme = isDarkMode ? darkTheme : lightTheme;

  return (
    <Container style={{ backgroundColor: theme.background }}>
      <Header style={{ backgroundColor: theme.card }}>
        <BackButton onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={30} color={theme.text} />
        </BackButton>
        <Title style={{ color: theme.secondary }}>
          MEDICATION <TitleHighlight style={{ color: theme.primary }}>SCHEDULE</TitleHighlight>
        </Title>
      </Header>
      <ImageContainer style={{ backgroundColor: theme.card }}>
        <ScheduleImage source={require("@/assets/images/schedule.png")} />
      </ImageContainer>

      <ButtonContainer>
        <ActionButton 
          onPress={() => navigation.navigate('SetScreen' as never)}
          style={{ backgroundColor: theme.primary }}
        > 
          <ButtonText style={{ color: theme.card }}>SET</ButtonText>
        </ActionButton>
        <ActionButton 
          onPress={() => navigation.navigate("ModifyButton")}
          style={{ backgroundColor: theme.secondary }}
        >
          <ButtonText style={{ color: theme.card }}>MODIFY</ButtonText>
        </ActionButton>
      </ButtonContainer>
    </Container>
  );
};

export default ModifySchedule;

const Container = styled.View`
  flex: 1;
  align-items: center;
  padding: 20px;
`;

const Header = styled.View`
  width: 100%;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  padding: 15px;
  border-radius: 15px;
  elevation: 8;
  position: absolute;
  top: 40;
  left: 20;
  right: 20;
`;

const BackButton = styled.TouchableOpacity`
  padding: 10px;
`;

const Title = styled.Text`
  font-size: 22px;
  font-weight: bold;
  flex: 1;
  margin-left: 10px;
`;

const TitleHighlight = styled.Text``;

const ImageContainer = styled.View`
  width: 100%;
  align-items: center;
  margin-vertical: 20px;
  padding: 20px;
  border-radius: 15px;
  elevation: 3;
  margin-top: 120px;
`;

const ScheduleImage = styled.Image`
  width: 300px;
  height: 180px;
  resize-mode: contain;
`;

const ButtonContainer = styled.View`
  width: 100%;
  align-items: center;
`;

const ActionButton = styled.TouchableOpacity`
  width: 80%;
  padding: 15px;
  border-radius: 12px;
  align-items: center;
  margin-top: 10px;
  elevation: 3;
`;

const ButtonText = styled.Text`
  font-size: 16px;
  font-weight: bold;
`;
