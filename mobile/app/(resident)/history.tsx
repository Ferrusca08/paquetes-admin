import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { generateClient } from 'aws-amplify/api';
import { useAuth } from '../../lib/hooks/useAuth';
import { listMyPackages } from '../../lib/graphql/operations';
import { colors, spacing, fontSize, radius, statusConfig } from '../../lib/theme';

type Package = {
  id: string;
  buildingId: string;
  residentName: string;
  towerName?: string;
  unitNumber?: string;
  status: keyof typeof statusConfig;
  carrier?: string;
  trackingNumber?: string;
  pickupCode: string;
  createdAt: string;
  deliveredAt?: string;
};

const client = generateClient();

export default function ResidentHistoryScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const [packages, setPackages] = useState<Package[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchPackages = useCallback(async () => {
    if (!user?.residentId) return;
    try {
      const result = await client.graphql({
        query: listMyPackages,
        variables: { residentId: user.residentId, limit: 100 },
      });
      const items = (result as { data: { listMyPackages: { items: Package[] } } })
        .data.listMyPackages.items;
      const sorted = [...items].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
      setPackages(sorted);
    } catch {
      Alert.alert('Error', 'No se pudo cargar tu historial');
    }
  }, [user?.residentId]);

  useEffect(() => {
    setLoading(true);
    fetchPackages().finally(() => setLoading(false));
  }, [fetchPackages]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchPackages();
    setRefreshing(false);
  };

  if (!user?.residentId) {
    return (
      <View style={styles.center}>
        <Feather name="user" size={48} color={colors.gray400} style={styles.emptyIcon} />
        <Text style={styles.emptyTitle}>Perfil no vinculado</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <FlatList
      style={styles.container}
      data={packages}
      keyExtractor={(item) => item.id}
      contentContainerStyle={packages.length === 0 ? styles.centerContent : styles.list}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
      }
      ListEmptyComponent={
        <View style={styles.center}>
          <Feather name="inbox" size={48} color={colors.gray400} style={styles.emptyIcon} />
          <Text style={styles.emptyTitle}>Sin historial</Text>
          <Text style={styles.emptyText}>Aquí verás todos tus paquetes, incluidos los ya entregados.</Text>
        </View>
      }
      renderItem={({ item }) => (
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => router.push(`/(resident)/${item.id}?buildingId=${item.buildingId}`)}
        >
          <HistoryCard pkg={item} />
        </TouchableOpacity>
      )}
    />
  );
}

function HistoryCard({ pkg }: { pkg: Package }) {
  const cfg = statusConfig[pkg.status] ?? statusConfig.RECIBIDO;
  const isPending = pkg.status === 'RECIBIDO' || pkg.status === 'NOTIFICADO';
  const date = new Date(pkg.deliveredAt ?? pkg.createdAt).toLocaleDateString('es-MX', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
  return (
    <View style={styles.card}>
      <View style={styles.cardLeft}>
        <View style={[styles.badge, { backgroundColor: cfg.bg }]}>
          <Text style={[styles.badgeText, { color: cfg.color }]}>{cfg.label}</Text>
        </View>
        <Text style={styles.carrier}>{pkg.carrier ?? 'Paquete'}</Text>
        {pkg.trackingNumber && (
          <Text style={styles.tracking} numberOfLines={1}>{pkg.trackingNumber}</Text>
        )}
        <Text style={styles.date}>
          {pkg.deliveredAt ? `Entregado · ${date}` : `Recibido · ${date}`}
        </Text>
      </View>
      {isPending && (
        <View style={styles.cardRight}>
          <Text style={styles.codeLabel}>Código</Text>
          <Text style={styles.code}>{pkg.pickupCode}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.gray50 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  centerContent: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  list: { padding: spacing.md, gap: spacing.sm },
  card: {
    backgroundColor: colors.white, borderRadius: radius.md,
    padding: spacing.md, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    shadowColor: colors.black, shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  cardLeft: { flex: 1 },
  badge: { borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 3, alignSelf: 'flex-start', marginBottom: 6 },
  badgeText: { fontSize: fontSize.xs, fontWeight: '600' },
  carrier: { fontSize: fontSize.md, fontWeight: '600', color: colors.gray900 },
  tracking: { fontSize: fontSize.sm, color: colors.gray500, marginTop: 2 },
  date: { fontSize: fontSize.xs, color: colors.gray400, marginTop: 4 },
  cardRight: { alignItems: 'center', marginLeft: spacing.md },
  codeLabel: { fontSize: fontSize.xs, color: colors.gray500 },
  code: { fontSize: fontSize.lg, fontWeight: '800', color: colors.primary, letterSpacing: 2 },
  emptyIcon: { fontSize: 48, marginBottom: spacing.md },
  emptyTitle: { fontSize: fontSize.lg, fontWeight: '600', color: colors.gray700, marginBottom: spacing.sm },
  emptyText: { fontSize: fontSize.base, color: colors.gray500, textAlign: 'center' },
});
