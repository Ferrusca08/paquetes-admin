import { createContext, useContext } from 'react';
import {
  getCurrentUser,
  fetchAuthSession,
  fetchUserAttributes,
  signOut as amplifySignOut,
} from 'aws-amplify/auth';

// ─── Types ────────────────────────────────────────────────────

export type UserRole = 'GUARD' | 'RESIDENT' | 'ADMIN';

export type AuthUser = {
  sub: string;
  email: string;
  role: UserRole;
  buildingId: string | null;
  residentId: string | null;
};

export type AuthContextType = {
  user: AuthUser | null;
  isLoading: boolean;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
};

// ─── Context ──────────────────────────────────────────────────

export const AuthContext = createContext<AuthContextType>({
  user: null,
  isLoading: true,
  signOut: async () => {},
  refreshUser: async () => {},
});

export const useAuth = () => useContext(AuthContext);

// ─── Helpers ─────────────────────────────────────────────────

export async function loadCurrentUser(): Promise<AuthUser | null> {
  try {
    const { userId } = await getCurrentUser();
    const [session, attributes] = await Promise.all([
      fetchAuthSession(),
      fetchUserAttributes(),
    ]);

    const groups =
      (session.tokens?.idToken?.payload['cognito:groups'] as string[]) ?? [];

    const role: UserRole | null = groups.includes('guardias')
      ? 'GUARD'
      : groups.includes('residentes')
        ? 'RESIDENT'
        : groups.includes('admins')
          ? 'ADMIN'
          : null;

    if (!role) return null;

    return {
      sub: userId,
      email: attributes.email ?? '',
      role,
      buildingId: attributes['custom:buildingId'] ?? null,
      residentId: attributes['custom:residentId'] ?? null,
    };
  } catch {
    return null;
  }
}

export async function appSignOut(): Promise<void> {
  await amplifySignOut();
}
