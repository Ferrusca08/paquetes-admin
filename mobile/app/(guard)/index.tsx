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
};

const client = generateClient();
const STATUSES = ['RECIBIDO', 'NOTIFICADO'] as const;

export default function PackageListScreen() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<(typeof STATUSES)[number]>('RECIBIDO');
  const [packages, setPackages] = useState<Package[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchPackages = useCallback(async () => {
    if (!user?.buildingId) return;
    try {
      const result = await client.graphql({
        query: listPackagesByStatus,
        variables: { buildingId: user.buildingId, status: activeTab, limit: 30 },
      });
      const data = (result as { data: { listPackagesByStatus: { items: Package[] } } })
        .data.listPackagesByStatus.items;
      setPackages(data);
    } catch (e) {
      Alert.alert('Error', 'No se pudieron cargar los paquetes');
    }
  }, [user?.buildingId, activeTab]);

  useEffect(() => {
    setLoading(true);
    fetchPackages().finally(() => setLoading(false));
  }, [fetchPackages]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchPackages();
    setRefreshing(false);
  };

  if (!user?.buildingId) {
    return (
      <View style={styles.center}>
        <Feather name="home" size={48} color={colors.gray400} style={styles.emptyIcon} />
        <Text style={styles.emptyTitle}>Sin edificio asignado</Text>
        <Text style={styles.emptyText}>
          Pide al administrador que asigne tu edificio en Cognito.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Status tabs */}
      <View style={styles.tabs}>
        {STATUSES.map((s) => (
          <TouchableOpacity
            key={s}
            style={[styles.tab, activeTab === s && styles.tabActive]}
            onPress={() => setActiveTab(s)}
            activeOpacity={0.7}
          >
            <Text style={[styles.tabText, activeTab === s && styles.tabTextActive]}>
              {statusConfig[s].label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

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
              <Feather name="inbox" size={48} color={colors.gray400} style={styles.emptyIcon} />
              <Text style={styles.emptyTitle}>Sin paquetes</Text>
              <Text style={styles.emptyText}>
                No hay paquetes con estado "{statusConfig[activeTab].label}".
              </Text>
            </View>
          }
          renderItem={({ item }) => <PackageCard pkg={item} />}
        />
      )}
    </View>
  );
}

function PackageCard({ pkg }: { pkg: Package }) {
  const cfg = statusConfig[pkg.status] ?? statusConfig.RECIBIDO;
  const date = new Date(pkg.createdAt).toLocaleDateString('es-MX', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
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
        {[pkg.towerName, `Depto ${pkg.unitNumber}`].filter(Boolean).join(' · ')}
      </Text>

      {pkg.carrier && (
        <Text style={styles.meta}>
          {pkg.carrier}
          {pkg.trackingNumber ? ` · ${pkg.trackingNumber}` : ''}
        </Text>
      )}

      <View style={styles.cardFooter}>
        <Text style={styles.codeHint}><Feather name="lock" size={11} color={colors.gray400} /> Código solo visible para el residente</Text>
        <Text style={styles.date}>{date}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.gray50 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  centerContent: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  list: { padding: spacing.md, gap: spacing.sm },
  tabs: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.gray200,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: { borderBottomColor: colors.primary },
  tabText: { fontSize: fontSize.base, color: colors.gray500, fontWeight: '500' },
  tabTextActive: { color: colors.primary, fontWeight: '600' },
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.md,
    padding: spacing.md,
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  residentName: { fontSize: fontSize.md, fontWeight: '600', color: colors.gray900, flex: 1 },
  badge: { borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 3, marginLeft: spacing.sm },
  badgeText: { fontSize: fontSize.xs, fontWeight: '600' },
  unit: { fontSize: fontSize.sm, color: colors.gray600, marginTop: 4 },
  meta: { fontSize: fontSize.sm, color: colors.gray500, marginTop: 2 },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.gray100,
  },
  codeHint: { fontSize: fontSize.xs, color: colors.gray400, fontStyle: 'italic', flex: 1 },
  date: { fontSize: fontSize.xs, color: colors.gray400 },
  emptyIcon: { fontSize: 48, marginBottom: spacing.md },
  emptyTitle: { fontSize: fontSize.lg, fontWeight: '600', color: colors.gray700, marginBottom: spacing.sm },
  emptyText: { fontSize: fontSize.base, color: colors.gray500, textAlign: 'center' },
});
