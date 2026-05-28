export async function handler() {
  const config = {
    apiKey: process.env.MEADEVIL_FIREBASE_API_KEY || "",
    authDomain: process.env.MEADEVIL_FIREBASE_AUTH_DOMAIN || "",
    projectId: process.env.MEADEVIL_FIREBASE_PROJECT_ID || "",
    storageBucket: process.env.MEADEVIL_FIREBASE_STORAGE_BUCKET || "",
    messagingSenderId: process.env.MEADEVIL_FIREBASE_MESSAGING_SENDER_ID || "",
    appId: process.env.MEADEVIL_FIREBASE_APP_ID || ""
  };

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-store"
    },
    body: `window.MEADEVIL_FIREBASE = ${JSON.stringify(config)};`
  };
}
