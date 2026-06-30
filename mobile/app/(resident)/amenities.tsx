import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Modal,
  Alert,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { generateClient } from 'aws-amplify/api';
import { useAuth } from '../../lib/hooks/useAuth';
import {
  listAmenities,
  getAmenityAvailability,
  listMyReservations,
  createReservation,
  cancelReservation,
} from '../../lib/graphql/operations';
import { colors, spacing, fontSize, radius } from '../../lib/theme';

type Amenity = {
  id: string;
  name: string;
  category?: string;
  description?: string;
  capacity: number;
  slotMinutes: number;
  openTime: string;
  closeTime: string;
  days: number[];
  status: 'ACTIVE' | 'OUT_OF_SERVICE';
};
type Slot = { startTime: string; endTime: string; available: number };
type Reservation = {
  id: string;
  amenityName: string;
  date: string;
  startTime: string;
  endTime: string;
};

const client = generateClient();
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const DAY = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MON = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

export default function AmenitiesScreen() {
  const { user } = useAuth();
  const [tab, setTab] = useState<'available' | 'active'>('available');
  const [amenities, setAmenities] = useState<Amenity[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // reservation modal
  const [picked, setPicked] = useState<Amenity | null>(null);
  const [date, setDate] = useState<Date | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [booking, setBooking] = useState(false);

  const load = useCallback(async () => {
    if (!user?.buildingId || !user?.residentId) return;
    try {
      const [a, r] = await Promise.all([
        client.graphql({ query: listAmenities, variables: { buildingId: user.buildingId } }),
        client.graphql({ query: listMyReservations, variables: { residentId: user.residentId } }),
      ]);
      setAmenities(
        (a as { data: { listAmenities: { items: Amenity[] } } }).data.listAmenities.items.filter(
          (x) => x.status === 'ACTIVE',
        ),
      );
      setReservations(
        (r as { data: { listMyReservations: { items: Reservation[] } } }).data.listMyReservations.items,
      );
    } catch {
      Alert.alert('Error', 'No se pudieron cargar las amenidades');
    }
  }, [user?.buildingId, user?.residentId]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  // ─── reservation flow ───────────────────────────────────────
  const openReserve = (a: Amenity) => {
    setPicked(a);
    setDate(null);
    setSlots([]);
  };
  const closeReserve = () => setPicked(null);

  const upcomingDates = (a: Amenity): Date[] => {
    const out: Date[] = [];
    const base = new Date();
    for (let i = 0; i < 21 && out.length < 14; i++) {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      if (a.days.includes(d.getDay())) out.push(d);
    }
    return out;
  };

  const pickDate = async (a: Amenity, d: Date) => {
    setDate(d);
    setSlots([]);
    setSlotsLoading(true);
    try {
      const r = await client.graphql({
        query: getAmenityAvailability,
        variables: { buildingId: user!.buildingId, amenityId: a.id, date: ymd(d) },
      });
      setSlots((r as { data: { getAmenityAvailability: Slot[] } }).data.getAmenityAvailability);
    } catch {
      Alert.alert('Error', 'No se pudo cargar la disponibilidad');
    } finally {
      setSlotsLoading(false);
    }
  };

  const confirm = async (slot: Slot) => {
    if (!picked || !date) return;
    setBooking(true);
    try {
      await client.graphql({
        query: createReservation,
        variables: {
          input: {
            buildingId: user!.buildingId,
            amenityId: picked.id,
            residentId: user!.residentId,
            date: ymd(date),
            startTime: slot.startTime,
          },
        },
      });
      closeReserve();
      await load();
      setTab('active');
      Alert.alert('Reserva confirmada', `${picked.name} · ${ymd(date)} ${slot.startTime}`);
    } catch (e) {
      const gqlMsg = (e as { errors?: { message?: string }[] })?.errors?.[0]?.message;
      const msg = gqlMsg || (e instanceof Error ? e.message : 'No se pudo reservar');
      Alert.alert('No se pudo reservar', msg.replace(/^.*?:\s*/, ''));
      // refresh slots so a taken block updates
      pickDate(picked, date);
    } finally {
      setBooking(false);
    }
  };

  const cancel = (r: Reservation) => {
    Alert.alert('Cancelar reserva', `¿Cancelar ${r.amenityName} del ${r.date} ${r.startTime}?`, [
      { text: 'No', style: 'cancel' },
      {
        text: 'Sí, cancelar',
        style: 'destructive',
        onPress: async () => {
          try {
            await client.graphql({
              query: cancelReservation,
              variables: { buildingId: user!.buildingId, reservationId: r.id },
            });
            await load();
          } catch {
            Alert.alert('Error', 'No se pudo cancelar');
          }
        },
      },
    ]);
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
        <Tab label="Disponibles" active={tab === 'available'} onPress={() => setTab('available')} />
        <Tab label="Activas" active={tab === 'active'} onPress={() => setTab('active')} />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : tab === 'available' ? (
        <FlatList
          data={amenities}
          keyExtractor={(i) => i.id}
          contentContainerStyle={amenities.length === 0 ? styles.centerContent : styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListEmptyComponent={<Empty icon="calendar" title="Sin amenidades" text="Aún no hay amenidades disponibles." />}
          renderItem={({ item }) => <AmenityBanner amenity={item} onPress={() => openReserve(item)} />}
        />
      ) : (
        <FlatList
          data={reservations}
          keyExtractor={(i) => i.id}
          contentContainerStyle={reservations.length === 0 ? styles.centerContent : styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListEmptyComponent={<Empty icon="inbox" title="Sin reservas" text="Tus reservas activas aparecerán aquí." />}
          renderItem={({ item }) => <ReservationCard r={item} onCancel={() => cancel(item)} />}
        />
      )}

      {/* Reservation modal */}
      <Modal visible={!!picked} animationType="slide" transparent onRequestClose={closeReserve}>
        <View style={styles.modalBg}>
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>{picked?.name}</Text>
              <TouchableOpacity onPress={closeReserve}><Feather name="x" size={24} color={colors.gray500} /></TouchableOpacity>
            </View>
            {picked && (
              <ScrollView style={{ maxHeight: 460 }}>
                <Text style={styles.sub}>{picked.openTime}–{picked.closeTime} · bloques de {picked.slotMinutes} min · cupo {picked.capacity}</Text>

                <Text style={styles.label}>1. Elige el día</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.md }}>
                  {upcomingDates(picked).map((d) => {
                    const sel = date && ymd(d) === ymd(date);
                    return (
                      <TouchableOpacity key={ymd(d)} style={[styles.dateChip, sel && styles.dateChipSel]} onPress={() => pickDate(picked, d)}>
                        <Text style={[styles.dateDow, sel && styles.dateTextSel]}>{DAY[d.getDay()]}</Text>
                        <Text style={[styles.dateNum, sel && styles.dateTextSel]}>{d.getDate()}</Text>
                        <Text style={[styles.dateMon, sel && styles.dateTextSel]}>{MON[d.getMonth()]}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>

                {date && (
                  <>
                    <Text style={styles.label}>2. Elige el horario</Text>
                    {slotsLoading ? (
                      <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.lg }} />
                    ) : slots.length === 0 ? (
                      <Text style={styles.muted}>No hay horarios disponibles ese día.</Text>
                    ) : (
                      <View style={styles.slotWrap}>
                        {slots.map((s) => {
                          const full = s.available <= 0;
                          return (
                            <TouchableOpacity
                              key={s.startTime}
                              style={[styles.slot, full && styles.slotFull]}
                              disabled={full || booking}
                              onPress={() => confirm(s)}
                            >
                              <Text style={[styles.slotTime, full && styles.slotTimeFull]}>{s.startTime}</Text>
                              <Text style={[styles.slotCap, full && styles.slotTimeFull]}>
                                {full ? 'Lleno' : `${s.available} libre${s.available === 1 ? '' : 's'}`}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    )}
                    {booking && <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.md }} />}
                  </>
                )}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
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

function AmenityBanner({ amenity, onPress }: { amenity: Amenity; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.banner} onPress={onPress} activeOpacity={0.85}>
      <View style={styles.bannerIcon}><Feather name="calendar" size={24} color={colors.primary} /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.bannerName}>{amenity.name}</Text>
        {amenity.category ? <Text style={styles.bannerCat}>{amenity.category}</Text> : null}
        <Text style={styles.bannerMeta}>{amenity.openTime}–{amenity.closeTime} · cupo {amenity.capacity}</Text>
      </View>
      <Feather name="chevron-right" size={22} color={colors.gray400} />
    </TouchableOpacity>
  );
}

function ReservationCard({ r, onCancel }: { r: Reservation; onCancel: () => void }) {
  return (
    <View style={styles.card}>
      <View style={{ flex: 1 }}>
        <Text style={styles.cardName}>{r.amenityName}</Text>
        <Text style={styles.cardMeta}>{r.date} · {r.startTime}–{r.endTime}</Text>
      </View>
      <TouchableOpacity style={styles.cancelBtn} onPress={onCancel}>
        <Text style={styles.cancelText}>Cancelar</Text>
      </TouchableOpacity>
    </View>
  );
}

function Empty({ icon, title, text }: { icon: 'calendar' | 'inbox'; title: string; text: string }) {
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
  banner: {
    backgroundColor: colors.white, borderRadius: radius.md, padding: spacing.md,
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    shadowColor: colors.black, shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  bannerIcon: { width: 48, height: 48, borderRadius: radius.md, backgroundColor: colors.primaryLight, justifyContent: 'center', alignItems: 'center' },
  bannerName: { fontSize: fontSize.md, fontWeight: '700', color: colors.gray900 },
  bannerCat: { fontSize: fontSize.sm, color: colors.primary, marginTop: 1 },
  bannerMeta: { fontSize: fontSize.sm, color: colors.gray500, marginTop: 2 },
  card: {
    backgroundColor: colors.white, borderRadius: radius.md, padding: spacing.md,
    flexDirection: 'row', alignItems: 'center',
    shadowColor: colors.black, shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  cardName: { fontSize: fontSize.md, fontWeight: '700', color: colors.gray900 },
  cardMeta: { fontSize: fontSize.sm, color: colors.gray500, marginTop: 3 },
  cancelBtn: { borderWidth: 1, borderColor: colors.error, borderRadius: radius.sm, paddingVertical: 7, paddingHorizontal: 12 },
  cancelText: { color: colors.error, fontSize: fontSize.sm, fontWeight: '600' },
  emptyTitle: { fontSize: fontSize.lg, fontWeight: '600', color: colors.gray700, marginBottom: spacing.sm },
  emptyText: { fontSize: fontSize.base, color: colors.gray500, textAlign: 'center' },
  muted: { color: colors.gray500, fontSize: fontSize.base, marginVertical: spacing.md },
  // modal
  modalBg: { flex: 1, backgroundColor: 'rgba(15,23,42,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.white, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: spacing.lg, paddingBottom: spacing.xxl },
  sheetHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  sheetTitle: { fontSize: fontSize.lg, fontWeight: '800', color: colors.gray900 },
  sub: { fontSize: fontSize.sm, color: colors.gray500, marginBottom: spacing.md },
  label: { fontSize: fontSize.base, fontWeight: '700', color: colors.gray800, marginBottom: spacing.sm, marginTop: spacing.sm },
  dateChip: { width: 60, paddingVertical: 10, borderRadius: radius.md, borderWidth: 1, borderColor: colors.gray200, alignItems: 'center', marginRight: 8, backgroundColor: colors.white },
  dateChipSel: { backgroundColor: colors.primary, borderColor: colors.primary },
  dateDow: { fontSize: fontSize.xs, color: colors.gray500, fontWeight: '600' },
  dateNum: { fontSize: fontSize.lg, fontWeight: '800', color: colors.gray900 },
  dateMon: { fontSize: fontSize.xs, color: colors.gray500 },
  dateTextSel: { color: colors.white },
  slotWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  slot: { width: '31%', borderWidth: 1, borderColor: colors.primary, borderRadius: radius.md, paddingVertical: 11, alignItems: 'center' },
  slotFull: { borderColor: colors.gray200, backgroundColor: colors.gray50 },
  slotTime: { fontSize: fontSize.base, fontWeight: '700', color: colors.primary },
  slotCap: { fontSize: 11, color: colors.gray500, marginTop: 2 },
  slotTimeFull: { color: colors.gray400 },
});
