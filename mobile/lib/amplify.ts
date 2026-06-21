import 'react-native-get-random-values';
import 'react-native-url-polyfill/auto';
import { Amplify } from 'aws-amplify';
import { cognitoUserPoolsTokenProvider } from 'aws-amplify/auth/cognito';
import AsyncStorage from '@react-native-async-storage/async-storage';

Amplify.configure({
  Auth: {
    Cognito: {
      userPoolId: process.env.EXPO_PUBLIC_COGNITO_USER_POOL_ID!,
      userPoolClientId: process.env.EXPO_PUBLIC_COGNITO_APP_CLIENT_ID!,
    },
  },
  API: {
    GraphQL: {
      endpoint: process.env.EXPO_PUBLIC_APPSYNC_URL!,
      region: process.env.EXPO_PUBLIC_AWS_REGION ?? 'us-east-1',
      defaultAuthMode: 'userPool',
    },
  },
});

// Persist tokens across app restarts (default is in-memory only)
cognitoUserPoolsTokenProvider.setKeyValueStorage(AsyncStorage);
