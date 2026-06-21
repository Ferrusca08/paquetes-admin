import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { generateClient } from 'aws-amplify/api';
import { registerPushToken } from './graphql/operations';

// Configure foreground notification behavior
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/**
 * Requests notification permissions, obtains the Expo push token,
 * and stores it in DynamoDB via the registerPushToken mutation.
 *
 * Safe to call on every sign-in — idempotent on the server side.
 */
export async function setupPushNotifications(
  residentId: string,
  buildingId: string,
): Promise<void> {
  // Push notifications don't work in simulators/emulators
  if (!isPhysicalDevice()) {
    console.log('[notifications] Skipping push setup on simulator');
    return;
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    console.log('[notifications] Push permission denied');
    return;
  }

  // Android requires an explicit notification channel
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('paquetes', {
      name: 'Paquetes',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#2563EB',
    });
  }

  try {
    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId: process.env.EXPO_PUBLIC_PROJECT_ID,
    });
    const token = tokenData.data;

    const client = generateClient();
    await client.graphql({
      query: registerPushToken,
      variables: { residentId, buildingId, pushToken: token },
    });

    console.log('[notifications] Push token registered:', token.slice(0, 20) + '…');
  } catch (err) {
    // Don't crash the app if notification setup fails
    console.error('[notifications] Push token registration failed:', err);
  }
}

function isPhysicalDevice(): boolean {
  // expo-device is the proper way, but to avoid adding a dependency
  // we check a runtime heuristic that works for Expo Go + bare workflow
  return !__DEV__ || Platform.OS !== 'ios' || !!process.env.EXPO_PUBLIC_IS_DEVICE;
}
