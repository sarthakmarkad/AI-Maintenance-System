# Google sign-in setup for the local Maintenance pilot

Google OAuth is now configured by the owner. Hosted provider settings and the real redirect to Google were verified; the owner reports checking the login. The steps below are retained for future setup. Existing email/password login works throughout setup. Do not send passwords or the Google client secret in chat or put them in frontend configuration.

## 1. Create the Google web client

Open [Google Cloud Console](https://console.cloud.google.com/) and select or create the project you want to own Maintenance authentication. In Google Auth Platform:

1. Configure the app name (Maintenance), your support contact and developer contact. For a personal Gmail account, use External audience and Testing while piloting. Add your own Gmail address as a test user. Keep any existing organization configuration unchanged.
2. Use only basic sign-in scopes: `openid`, email and profile. Maintenance does not need Gmail, Drive, Calendar or offline Google access.
3. Under Clients, create an OAuth client with application type **Web application**.
4. Set **Authorized JavaScript origins** to `http://localhost:3000`.
5. Set **Authorized redirect URIs** to `https://atfjdjliclqzzapetnrr.supabase.co/auth/v1/callback`.
6. Keep the resulting Client ID and Client Secret privately for the next step. Enter secrets directly in the provider dashboard yourself.

This pilot has a local web app and hosted Supabase Auth. Google's redirect points to hosted Supabase, which then returns to the local app. A localhost Supabase emulator callback is not used.

## 2. Connect it to Maintenance in Supabase

Open the [Maintenance project](https://supabase.com/dashboard/project/atfjdjliclqzzapetnrr). Under Authentication, open Sign In / Providers and select Google:

1. Enter the Google web Client ID and Client Secret directly in Supabase and enable Google.
2. Keep nonce verification and secure email verification enabled; do not enable insecure email handling or automatic role assignment.
3. In Authentication URL Configuration, set the local **Site URL** to `http://localhost:3000` and allow the exact redirect URL `http://localhost:3000/auth/callback`. Preserve any existing authorized redirect entries. No wildcard redirect is needed for this pilot.
4. Save the configuration. No client secret belongs in `.env.local`, a public key setting, Git, or this chat.

## 3. Verify the real flow

1. Open [Maintenance login](http://localhost:3000/login), signing out of the app first if necessary.
2. The Google button checks Supabase's public provider settings. Once enabled, click **Sign in with Google** and choose the same approved Gmail account you already use for Maintenance.
3. Complete any Google password, verification or consent steps yourself. The app uses PKCE, exchanges the returned code in the initiating browser and verifies workspace access through NestJS.
4. Confirm that your existing account appears, Administrator is the default view, and Active role contains the six granted views. Do not create a second identity or assign privileges automatically if a different Auth UUID appears; verify the provider identity first.
5. Switch roles and confirm the appropriate controls. Sign out, sign in again and verify the default role returns. A cancelled or expired Google flow must show a recoverable error; an unprovisioned Google identity must receive no workspace access.

Provider availability and redirect were independently verified after setup. The owner reports checking the actual login and asked the agent to stop the sign-in test. The agent did not independently inspect a completed Google callback or account linkage. Fixture results remain distinct from that owner-reported check.

References: [Supabase Google provider setup](https://supabase.com/docs/guides/auth/social-login/auth-google), [PKCE flow](https://supabase.com/docs/guides/auth/sessions/pkce-flow), [redirect allow list](https://supabase.com/docs/guides/auth/redirect-urls).
