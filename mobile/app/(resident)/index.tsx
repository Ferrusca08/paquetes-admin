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

export default function MyPackagesScreen() {
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
        variables: { residentId: user.residentId, limit: 30 },
      });
      const items = (result as { data: { listMyPackages: { items: Package[] } } })
        .data.listMyPackages.items;
      setPackages(items);
    } catch {
      Alert.alert('Error', 'No se pudieron cargar tus paquetes');
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
        <Text style={styles.emptyIcon}>👤</Text>
        <Text style={styles.emptyTitle}>Perfil no vinculado</Text>
        <Text style={styles.emptyText}>
          Pide al administrador que vincule tu cuenta con tu perfil de residente.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={packages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={packages.length === 0 ? styles.centerContent : styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.emptyIcon}>📭</Text>
              <Text style={styles.emptyTitle}>Sin paquetes</Text>
              <Text style={styles.emptyText}>Tus paquetes aparecerán aquí cuando lleguen.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => router.push(`/(resident)/${item.id}?buildingId=${item.buildingId}`)}
            >
              <ResidentPackageCard pkg={item} />
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

function ResidentPackageCard({ pkg }: { pkg: Package }) {
  const cfg = statusConfig[pkg.status] ?? statusConfig.RECIBIDO;
  const date = new Date(pkg.createdAt).toLocaleDateString('es-MX', {
    day: '2-digit', month: 'short',
  });
  const isPending = pkg.status === 'RECIBIDO' || pkg.status === 'NOTIFICADO';

  return (
    <View style={[styles.card, isPending && styles.cardPending]}>
      <View style={styles.cardLeft}>
        <View style={[styles.badge, { backgroundColor: cfg.bg }]}>
          <Text style={[styles.badgeText, { color: cfg.color }]}>{cfg.label}</Text>
        </View>
        <Text style={styles.carrier}>{pkg.carrier ?? 'Paquete'}</Text>
        {pkg.trackingNumber && (
          <Text style={styles.tracking} numberOfLines={1}>{pkg.trackingNumber}</Text>
        )}
        <Text style={styles.date}>{date}</Text>
      </View>
      {isPending && (
        <View style={styles.cardRight}>
          <Text style={styles.codeLabel}>Código</Text>
          <Text style={styles.code}>{pkg.pickupCode}</Text>
          <Text style={styles.chevron}>›</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.gray50 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  centerContent: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  list: { padding: spacing.md, gap: spacing.sm },
  card: {
    backgroundColor: colors.white, borderRadius: radius.md,
    padding: spacing.md, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    shadowColor: colors.black, shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  cardPending: { borderLeftWidth: 3, borderLeftColor: colors.primary },
  cardLeft: { flex: 1 },
  badge: { borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 3, alignSelf: 'flex-start', marginBottom: 6 },
  badgeText: { fontSize: fontSize.xs, fontWeight: '600' },
  carrier: { fontSize: fontSize.md, fontWeight: '600', color: colors.gray900 },
  tracking: { fontSize: fontSize.sm, color: colors.gray500, marginTop: 2 },
  date: { fontSize: fontSize.xs, color: colors.gray400, marginTop: 4 },
  cardRight: { alignItems: 'center', marginLeft: spacing.md },
  codeLabel: { fontSize: fontSize.xs, color: colors.gray500 },
  code: { fontSize: fontSize.lg, fontWeight: '800', color: colors.primary, letterSpacing: 2 },
  chevron: { fontSize: 20, color: colors.gray400, marginTop: 4 },
  emptyIcon: { fontSize: 48, marginBottom: spacing.md },
  emptyTitle: { fontSize: fontSize.lg, fontWeight: '600', color: colors.gray700, marginBottom: spacing.sm },
  emptyText: { fontSize: fontSize.base, color: colors.gray500, textAlign: 'center' },
});
