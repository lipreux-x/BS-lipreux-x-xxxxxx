/*
 * Entry point. The push background task (services/push.ts) must be defined
 * in a module that runs even when the app starts headless for a silent
 * push: no screen is drawn then, and Expo Router loads route files only to
 * draw them, so a task defined under app/ would never exist ("No task
 * registered for key expo-task-manager"). Imported first, before the router.
 */
import './src/services/push';
import 'expo-router/entry';
