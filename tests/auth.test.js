import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import CreateScreen from '../app/Create';
import LoginScreen from '../app/LoginScreen';
import { Alert } from 'react-native';

jest.mock('expo-router', () => ({
    useRouter: () => ({
        push: jest.fn(),
        replace: jest.fn(),
    }),
    useFocusEffect: jest.fn(),
}));

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: jest.fn(),
    goBack: jest.fn(),
  }),
}));

jest.mock('@/context/ThemeContext', () => ({
    useTheme: () => ({
        isDarkMode: false,
        lightTheme: {
            background: '#fff',
            card: '#f2f2f2',
            text: '#000',
            textSecondary: '#666',
            primary: '#007bff',
            border: '#ccc',
        },
        darkTheme: {
            background: '#000',
            card: '#1a1a1a',
            text: '#fff',
            textSecondary: '#999',
            primary: '#007bff',
            border: '#333',
        }
    })
}))

describe('CreateScreen', () => {
    it('shows an alert if password is less than 6 characters', async () => {
        const spyAlert = jest.spyOn(Alert, 'alert');
        const { getByPlaceholderText, getByText } = render(<CreateScreen />);

        fireEvent.changeText(getByPlaceholderText('Full Name'), 'Test User');
        fireEvent.changeText(getByPlaceholderText('Email Address'), 'test@example.com');
        fireEvent.changeText(getByPlaceholderText('Phone Number'), '1234567890');
        fireEvent.changeText(getByPlaceholderText('Password'), '12345');
        
        await act(async () => {
            fireEvent.press(getByText('Create Account'));
        });

        expect(spyAlert).toHaveBeenCalledWith(
            "Invalid Password",
            "Password must be at least 6 characters long."
        );
    });

    it('shows an alert if password does not contain a number', async () => {
        const spyAlert = jest.spyOn(Alert, 'alert');
        const { getByPlaceholderText, getByText } = render(<CreateScreen />);

        fireEvent.changeText(getByPlaceholderText('Full Name'), 'Test User');
        fireEvent.changeText(getByPlaceholderText('Email Address'), 'test@example.com');
        fireEvent.changeText(getByPlaceholderText('Phone Number'), '1234567890');
        fireEvent.changeText(getByPlaceholderText('Password'), 'password');

        await act(async () => {
            fireEvent.press(getByText('Create Account'));
        });

        expect(spyAlert).toHaveBeenCalledWith(
            "Invalid Password",
            "Password must contain at least one number."
        );
        });
    });
    
    
    describe('LoginScreen', () => {
        it('shows an alert if password is less than 6 characters', async () => {
            const spyAlert = jest.spyOn(Alert, 'alert');
            const { getByPlaceholderText, getByText } = render(<LoginScreen />);
    
            fireEvent.changeText(getByPlaceholderText('Email'), 'test@example.com');
            fireEvent.changeText(getByPlaceholderText('Password'), '12345');
            
            await act(async () => {
                fireEvent.press(getByText('Login'));
            });
    
            expect(spyAlert).toHaveBeenCalledWith(
                "Invalid Password",
                "Password must be at least 6 characters long."
            );
        });
    
        it('shows an alert if password does not contain a number', async () => {
            const spyAlert = jest.spyOn(Alert, 'alert');
            const { getByPlaceholderText, getByText } = render(<LoginScreen />);
    
            fireEvent.changeText(getByPlaceholderText('Email'), 'test@example.com');
            fireEvent.changeText(getByPlaceholderText('Password'), 'password');
    
            await act(async () => {
                fireEvent.press(getByText('Login'));
            });
    
            expect(spyAlert).toHaveBeenCalledWith(
                "Invalid Password",
                "Password must contain at least one number."
            );
        });
    });
    
    
