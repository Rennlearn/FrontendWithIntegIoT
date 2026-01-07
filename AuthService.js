// AuthService.js

// TODO: Replace <YOUR_SERVER_IP> with your actual server IP address
const BASE_URL = 'http://<YOUR_SERVER_IP>:3000/api/auth';

export const requestOtp = async (email) => {
  try {
    const response = await fetch(`${BASE_URL}/send-otp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email }),
    });

    const data = await response.json();

    if (response.ok) {
      return { success: true, message: data.message };
    } else {
      return { success: false, message: data.message || 'Failed to send OTP' };
    }
  } catch (error) {
    console.error('Request OTP Network Error:', error);
    return { success: false, message: 'Network error. Please check your connection.' };
  }
};

export const verifyOtp = async (email, code) => {
  try {
    const response = await fetch(`${BASE_URL}/verify-otp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        email: email,
        otp: code 
      }),
    });

    const data = await response.json();

    if (response.ok) {
      return { success: true, message: data.message };
    } else {
      return { success: false, message: data.message || 'Verification failed' };
    }
  } catch (error) {
    console.error('Verify OTP Network Error:', error);
    return { success: false, message: 'Network error. Please check your connection.' };
  }
};