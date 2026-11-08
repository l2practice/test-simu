// Google OAuth settings. Fill these in after creating the OAuth client (see README, step 2).
//
// CLIENT_ID     : from a "Web application" OAuth client.
// CLIENT_SECRET : from the same OAuth client. OPTIONAL but recommended: with it the extension
//                 gets a long-lived refresh token, so you stay signed in and never see the
//                 1-hour token expiry. Without it, sign-in lasts ~1 hour per token and is
//                 renewed silently through your browser's Google session.
//
// This file stays on your computer inside the unpacked extension. Do not share it or commit it
// with real values.

export const CLIENT_ID = 'YOUR_CLIENT_ID.apps.googleusercontent.com';
export const CLIENT_SECRET = '';

export const SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.file'
];
