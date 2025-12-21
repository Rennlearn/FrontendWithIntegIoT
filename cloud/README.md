## Email OTP Service (Render)

This repo includes a **separate cloud service** you can deploy on Render to send **password reset OTP codes via email**.

### What it does
- User enters phone number in the app
- Service looks up the user's email in your existing cloud API (`pillnow-database.onrender.com`)
- Service emails a 6-digit OTP to that email
- User verifies OTP → service issues `resetToken`
- User submits new password + `resetToken` → service calls cloud `/api/users/reset-password`

### Deploy to Render
1) Create a new **Web Service** in Render from this repo
2) **Start Command**:

```bash
node cloud/email_otp_service.js
```

3) **Environment variables** (Render → Environment):
- `CLOUD_API_BASE=https://pillnow-database.onrender.com`
- `EMAIL_ENABLED=true`
- `EMAIL_FROM=pillnowalerts@gmail.com`
- `EMAIL_HOST=smtp.gmail.com`
- `EMAIL_PORT=587`
- `EMAIL_USER=pillnowalerts@gmail.com`
- `EMAIL_PASS=<Gmail App Password>`
- (optional) `CORS_ORIGIN=*`

### App configuration
Set this Expo public env var for your app build:

- `EXPO_PUBLIC_EMAIL_OTP_API_BASE=https://<your-render-service>.onrender.com`

If not set, the app falls back to `http://10.56.196.91:5001`.


