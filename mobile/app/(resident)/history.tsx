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
import { listMyPackages, listMyReservations } from '../../lib/graphql/operations';
import { colors, spacing, fontSize, radius, statusConfig } from '../../lib/theme';

type Package = {
  id: string;
  buildingId: string;
  status: keyof typeof statusConfig;
  carrier?: string;
  trackingNumber?: string;
  pickupCode: string;
  createdAt: string;
  deliveredAt?: string;
};
type Reservation = {
  id: string;
  amenityName: string;
  date: string;
  startTime: string;
  endTime: string;
};

const client = generateClient();
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export default function ResidentHistoryScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<'packages' | 'reservations'>('packages');
  const [packages, setPackages] = useState<Package[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!user?.residentId) return;
    try {
      const [p, r] = await Promise.all([
        client.graphql({ query: listMyPackages, variables: { residentId: user.residentId, limit: 100 } }),
        client.graphql({
          query: listMyReservations,
          variables: { residentId: user.residentId, includePast: true },
        }),
      ]);
      const pkgs = (p as { data: { listMyPackages: { items: Package[] } } }).data.listMyPackages.items;
      setPackages([...pkgs].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
      setReservations(
        (r as { data: { listMyReservations: { items: Reservation[] } } }).data.listMyReservations.items,
      );
    } catch {
      Alert.alert('Error', 'No se pudo cargar tu historial');
    }
  }, [user?.residentId]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  if (!user?.residentId) {
    return (
      <View style={styles.center}>
        <Feather name="user" size={48} color={colors.gray400} style={{ marginBottom: spacing.md }} />
        <Text style={styles.emptyTitle}>Perfil no vinculado</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.tabs}>
        <Tab label="Paquetes" active={tab === 'packages'} onPress={() => setTab('packages')} />
        <Tab label="Reservaciones" active={tab === 'reservations'} onPress={() => setTab('reservations')} />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : tab === 'packages' ? (
        <FlatList
          data={packages}
          keyExtractor={(i) => i.id}
          contentContainerStyle={packages.length === 0 ? styles.centerContent : styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListEmptyComponent={<Empty icon="inbox" title="Sin paquetes" text="Aquí verás todos tus paquetes, incluidos los entregados." />}
          renderItem={({ item }) => (
            <TouchableOpacity activeOpacity={0.7} onPress={() => router.push(`/(resident)/${item.id}?buildingId=${item.buildingId}`)}>
              <PackageCard pkg={item} />
            </TouchableOpacity>
          )}
        />
      ) : (
        <FlatList
          data={reservations}
          keyExtractor={(i) => i.id}
          contentContainerStyle={reservations.length === 0 ? styles.centerContent : styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListEmptyComponent={<Empty icon="calendar" title="Sin reservaciones" text="Aquí verás todas tus reservas de amenidades." />}
          renderItem={({ item }) => <ReservationCard r={item} />}
        />
      )}
    </View>
  );
}

function Tab({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={[styles.tab, active && styles.tabActive]} onPress={onPress} activeOpacity={0.7}>
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

function PackageCard({ pkg }: { pkg: Package }) {
  const cfg = statusConfig[pkg.status] ?? statusConfig.RECIBIDO;
  const isPending = pkg.status === 'RECIBIDO' || pkg.status === 'NOTIFICADO';
  const date = new Date(pkg.deliveredAt ?? pkg.createdAt).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
  return (
    <View style={styles.card}>
      <View style={{ flex: 1 }}>
        <View style={[styles.badge, { backgroundColor: cfg.bg }]}>
          <Text style={[styles.badgeText, { color: cfg.color }]}>{cfg.label}</Text>
        </View>
        <Text style={styles.cardName}>{pkg.carrier ?? 'Paquete'}</Text>
        {pkg.trackingNumber && <Text style={styles.cardSub} numberOfLines={1}>{pkg.trackingNumber}</Text>}
        <Text style={styles.cardDate}>{pkg.deliveredAt ? `Entregado · ${date}` : `Recibido · ${date}`}</Text>
      </View>
      {isPending && (
        <View style={styles.codeBox}>
          <Text style={styles.codeLabel}>Código</Text>
          <Text style={styles.code}>{pkg.pickupCode}</Text>
        </View>
      )}
    </View>
  );
}

function ReservationCard({ r }: { r: Reservation }) {
  const past = r.date < todayStr();
  const date = new Date(`${r.date}T00:00:00`).toLocaleDateString('es-MX', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
  return (
    <View style={styles.card}>
      <View style={[styles.resIcon, past && styles.resIconPast]}>
        <Feather name="calendar" size={20} color={past ? colors.gray400 : colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <View style={[styles.badge, { backgroundColor: past ? colors.gray100 : colors.primaryLight }]}>
          <Text style={[styles.badgeText, { color: past ? colors.gray500 : colors.primary }]}>{past ? 'Pasada' : 'Próxima'}</Text>
        </View>
        <Text style={styles.cardName}>{r.amenityName}</Text>
        <Text style={styles.cardDate}>{date} · {r.startTime}–{r.endTime}</Text>
      </View>
    </View>
  );
}

function Empty({ icon, title, text }: { icon: 'inbox' | 'calendar'; title: string; text: string }) {
  return (
    <View style={styles.center}>
      <Feather name={icon} size={48} color={colors.gray400} style={{ marginBottom: spacing.md }} />
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.gray50 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  centerContent: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  list: { padding: spacing.md, gap: spacing.sm },
  tabs: { flexDirection: 'row', backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.gray200 },
  tab: { flex: 1, paddingVertical: 13, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: colors.primary },
  tabText: { fontSize: fontSize.base, color: colors.gray500, fontWeight: '500' },
  tabTextActive: { color: colors.primary, fontWeight: '700' },
  card: {
    backgroundColor: colors.white, borderRadius: radius.md, padding: spacing.md,
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    shadowColor: colors.black, shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  resIcon: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.primaryLight, justifyContent: 'center', alignItems: 'center' },
  resIconPast: { backgroundColor: colors.gray100 },
  badge: { borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 3, alignSelf: 'flex-start', marginBottom: 6 },
  badgeText: { fontSize: fontSize.xs, fontWeight: '600' },
  cardName: { fontSize: fontSize.md, fontWeight: '700', color: colors.gray900 },
  cardSub: { fontSize: fontSize.sm, color: colors.gray500, marginTop: 2 },
  cardDate: { fontSize: fontSize.xs, color: colors.gray400, marginTop: 4 },
  codeBox: { alignItems: 'center', marginLeft: spacing.md },
  codeLabel: { fontSize: fontSize.xs, color: colors.gray500 },
  code: { fontSize: fontSize.lg, fontWeight: '800', color: colors.primary, letterSpacing: 2 },
  emptyTitle: { fontSize: fontSize.lg, fontWeight: '600', color: colors.gray700, marginBottom: spacing.sm },
  emptyText: { fontSize: fontSize.base, color: colors.gray500, textAlign: 'center' },
});
