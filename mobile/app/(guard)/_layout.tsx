import { Tabs } from 'expo-router';
import { TouchableOpacity, Text, StyleSheet, Alert } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '../../lib/hooks/useAuth';
import { colors, fontSize } from '../../lib/theme';

export default function GuardLayout() {
  const { signOut, user } = useAuth();

  const handleSignOut = () => {
    Alert.alert('Cerrar sesión', '¿Estás seguro?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Salir', style: 'destructive', onPress: signOut },
    ]);
  };

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.gray400,
        tabBarStyle: { borderTopColor: colors.gray200 },
        headerStyle: { backgroundColor: colors.white },
        headerTitleStyle: { fontWeight: '700', color: colors.gray900 },
        headerRight: () => (
          <TouchableOpacity onPress={handleSignOut} style={styles.signOut}>
            <Text style={styles.signOutText}>Salir</Text>
          </TouchableOpacity>
        ),
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Paquetes',
          tabBarLabel: 'Paquetes',
          tabBarIcon: ({ color }) => <Feather name="package" size={20} color={color} />,
          headerTitle: `Paquetes — ${user?.buildingId ? '' : 'Sin edificio'}`,
        }}
      />
      <Tabs.Screen
        name="register"
        options={{
          title: 'Registrar',
          tabBarLabel: 'Registrar',
          tabBarIcon: ({ color }) => <Feather name="plus-circle" size={20} color={color} />,
        }}
      />
      <Tabs.Screen
        name="pickup"
        options={{
          title: 'Retiro',
          tabBarLabel: 'Retiro',
          tabBarIcon: ({ color }) => <Feather name="check-circle" size={20} color={color} />,
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'Historial',
          tabBarLabel: 'Historial',
          tabBarIcon: ({ color }) => <Feather name="clock" size={20} color={color} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  signOut: {
    marginRight: 16,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  signOutText: {
    color: colors.error,
    fontSize: fontSize.base,
    fontWeight: '500',
  },
});
