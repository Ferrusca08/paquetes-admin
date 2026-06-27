import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { generateClient } from 'aws-amplify/api';
import { useAuth } from '../../lib/hooks/useAuth';
import { listPackagesByStatus } from '../../lib/graphql/operations';
import { colors, spacing, fontSize, radius, statusConfig } from '../../lib/theme';

type Package = {
  id: string;
  residentName: string;
  towerName?: string;
  unitNumber?: string;
  status: keyof typeof statusConfig;
  carrier?: string;
  trackingNumber?: string;
  createdAt: string;
  deliveredAt?: string;
};

const client = generateClient();
// Full history across every status (the active queue lives in the Paquetes tab)
const ALL_STATUSES = ['RECIBIDO', 'NOTIFICADO', 'ENTREGADO', 'DEVUELTO', 'EXPIRADO'] as const;

export default function GuardHistoryScreen() {
  const { user } = useAuth();
  const [packages, setPackages] = useState<Package[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchAll = useCallback(async () => {
    if (!user?.buildingId) return;
    try {
      const results = await Promise.all(
        ALL_STATUSES.map((status) =>
          client
            .graphql({
              query: listPackagesByStatus,
              variables: { buildingId: user.buildingId, status, limit: 100 },
            })
            .then(
              (r) =>
                (r as { data: { listPackagesByStatus: { items: Package[] } } })
                  .data.listPackagesByStatus.items,
            )
            .catch(() => [] as Package[]),
        ),
      );
      const all = results.flat().sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
      setPackages(all);
    } catch {
      Alert.alert('Error', 'No se pudo cargar el historial');
    }
  }, [user?.buildingId]);

  useEffect(() => {
    setLoading(true);
    fetchAll().finally(() => setLoading(false));
  }, [fetchAll]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchAll();
    setRefreshing(false);
  };

  if (!user?.buildingId) {
    return (
      <View style={styles.center}>
        <Feather name="home" size={48} color={colors.gray400} style={styles.emptyIcon} />
        <Text style={styles.emptyTitle}>Sin edificio asignado</Text>
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
      ListHeaderComponent={
        packages.length > 0 ? (
          <Text style={styles.count}>{packages.length} paquetes en total</Text>
        ) : null
      }
      ListEmptyComponent={
        <View style={styles.center}>
          <Feather name="inbox" size={48} color={colors.gray400} style={styles.emptyIcon} />
          <Text style={styles.emptyTitle}>Sin historial</Text>
          <Text style={styles.emptyText}>Aún no se ha registrado ningún paquete.</Text>
        </View>
      }
      renderItem={({ item }) => <HistoryCard pkg={item} />}
    />
  );
}

function HistoryCard({ pkg }: { pkg: Package }) {
  const cfg = statusConfig[pkg.status] ?? statusConfig.RECIBIDO;
  const date = new Date(pkg.deliveredAt ?? pkg.createdAt).toLocaleDateString('es-MX', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.residentName}>{pkg.residentName}</Text>
        <View style={[styles.badge, { backgroundColor: cfg.bg }]}>
          <Text style={[styles.badgeText, { color: cfg.color }]}>{cfg.label}</Text>
        </View>
      </View>
      <Text style={styles.unit}>
        {[pkg.towerName, pkg.unitNumber ? `Depto ${pkg.unitNumber}` : ''].filter(Boolean).join(' · ')}
      </Text>
      {pkg.carrier && (
        <Text style={styles.meta}>
          {pkg.carrier}{pkg.trackingNumber ? ` · ${pkg.trackingNumber}` : ''}
        </Text>
      )}
      <Text style={styles.date}>
        {pkg.deliveredAt ? `Entregado · ${date}` : `Registrado · ${date}`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.gray50 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  centerContent: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  list: { padding: spacing.md, gap: spacing.sm },
  count: { fontSize: fontSize.sm, color: colors.gray500, marginBottom: spacing.xs, paddingHorizontal: 2 },
  card: {
    backgroundColor: colors.white, borderRadius: radius.md, padding: spacing.md,
    shadowColor: colors.black, shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  residentName: { fontSize: fontSize.md, fontWeight: '600', color: colors.gray900, flex: 1 },
  badge: { borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 3, marginLeft: spacing.sm },
  badgeText: { fontSize: fontSize.xs, fontWeight: '600' },
  unit: { fontSize: fontSize.sm, color: colors.gray600, marginTop: 4 },
  meta: { fontSize: fontSize.sm, color: colors.gray500, marginTop: 2 },
  date: { fontSize: fontSize.xs, color: colors.gray400, marginTop: spacing.sm },
  emptyIcon: { fontSize: 48, marginBottom: spacing.md },
  emptyTitle: { fontSize: fontSize.lg, fontWeight: '600', color: colors.gray700, marginBottom: spacing.sm },
  emptyText: { fontSize: fontSize.base, color: colors.gray500, textAlign: 'center' },
});
