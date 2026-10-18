// API of the Neon `dev` branch by default. Override per build with
// EXPO_PUBLIC_API_URL (e.g. the `main` branch URL for production).
export const API_URL = (
  process.env.EXPO_PUBLIC_API_URL ?? 'https://br-muddy-bar-barqix1g-api.compute.c-8.eu-central-1.aws.neon.tech'
).replace(/\/$/, '');
