import { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useLocalSearchParams, useNavigation } from 'expo-router';
import { generateClient } from 'aws-amplify/api';
import { getPackage } from '../../lib/graphql/operations';
import { colors, spacing, fontSize, radius, statusConfig } from '../../lib/theme';

type Package = {
  id: string;
  residentName: string;
  towerName?: string;
  unitNumber?: string;
  status: keyof typeof statusConfig;
  carrier?: string;
  trackingNumber?: string;
  pickupCode: string;
  registeredBy: string;
  deliveredBy?: string;
  deliveredAt?: string;
  createdAt: string;
  expiresAt?: string;
};

const client = generateClient();

export default function PackageDetailScreen() {
  const { id, buildingId } = useLocalSearchParams<{ id: string; buildingId: string }>();
  const navigation = useNavigation();
  const [pkg, setPkg] = useState<Package | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    navigation.setOptions({ title: 'Detalle de paquete', headerShown: true });
  }, [navigation]);

  useEffect(() => {
    if (!id || !buildingId) return;
    (
      client.graphql({
        query: getPackage,
        variables: { buildingId, packageId: id },
      }) as Promise<{ data: { getPackage: Package | null } }>
    )
      .then((result) => {
        const p = result.data.getPackage;
        if (!p) Alert.alert('Error', 'Paquete no encontrado');
        else setPkg(p);
      })
      .catch(() => Alert.alert('Error', 'No se pudo cargar el paquete'))
      .finally(() => setLoading(false));
  }, [id, buildingId]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!pkg) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Paquete no encontrado</Text>
      </View>
    );
  }

  const cfg = statusConfig[pkg.status] ?? statusConfig.RECIBIDO;
  const isPending = pkg.status === 'RECIBIDO' || pkg.status === 'NOTIFICADO';
  const isDelivered = pkg.status === 'ENTREGADO';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Status header */}
      <View style={[styles.statusHeader, { backgroundColor: cfg.bg }]}>
        <Text style={[styles.statusLabel, { color: cfg.color }]}>{cfg.label}</Text>
        {isDelivered && pkg.deliveredAt && (
          <Text style={[styles.statusDate, { color: cfg.color }]}>
            Entregado el {new Date(pkg.deliveredAt).toLocaleDateString('es-MX', {
              day: '2-digit', month: 'long', year: 'numeric',
            })}
          </Text>
        )}
      </View>

      {/* Pickup code — only shown when pending */}
      {isPending && (
        <View style={styles.codeSection}>
          <Text style={styles.codeInstructions}>
            Muestra este código en recepción para retirar tu paquete
          </Text>
          <View style={styles.codeBox}>
            <Text style={styles.codeValue}>{pkg.pickupCode}</Text>
          </View>
          {pkg.expiresAt && (
            <Text style={styles.codeExpiry}>
              Vence el {new Date(pkg.expiresAt).toLocaleDateString('es-MX', {
                day: '2-digit', month: 'long', year: 'numeric',
              })}
            </Text>
          )}
        </View>
      )}

      {/* Package details */}
      <View style={styles.detailsCard}>
        <Text style={styles.cardTitle}>Información del paquete</Text>

        <DetailRow label="Transportista" value={pkg.carrier ?? '—'} />
        {pkg.trackingNumber && (
          <DetailRow label="Número de rastreo" value={pkg.trackingNumber} mono />
        )}
        <DetailRow
          label="Fecha de llegada"
          value={new Date(pkg.createdAt).toLocaleDateString('es-MX', {
            weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
          })}
        />
        {pkg.towerName && <DetailRow label="Torre" value={pkg.towerName} />}
        {pkg.unitNumber && <DetailRow label="Departamento" value={pkg.unitNumber} />}
        {isDelivered && pkg.deliveredAt && (
          <DetailRow
            label="Fecha de entrega"
            value={new Date(pkg.deliveredAt).toLocaleDateString('es-MX', {
              weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
            })}
          />
        )}
      </View>
    </ScrollView>
  );
}

function DetailRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, mono && styles.rowValueMono]} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.gray50 },
  content: { paddingBottom: spacing.xxl },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  errorText: { fontSize: fontSize.base, color: colors.error },
  statusHeader: {
    padding: spacing.lg,
    alignItems: 'center',
  },
  statusLabel: {
    fontSize: fontSize.xl,
    fontWeight: '700',
  },
  statusDate: {
    fontSize: fontSize.sm,
    marginTop: 4,
    opacity: 0.8,
  },
  codeSection: {
    backgroundColor: colors.white,
    margin: spacing.md,
    borderRadius: radius.lg,
    padding: spacing.lg,
    alignItems: 'center',
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 4,
  },
  codeInstructions: {
    fontSize: fontSize.sm,
    color: colors.gray600,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  codeBox: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xl,
    minWidth: 200,
    alignItems: 'center',
  },
  codeValue: {
    fontSize: fontSize.hero,
    fontWeight: '900',
    color: colors.white,
    letterSpacing: 8,
  },
  codeExpiry: {
    fontSize: fontSize.xs,
    color: colors.gray400,
    marginTop: spacing.sm,
  },
  detailsCard: {
    backgroundColor: colors.white,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    borderRadius: radius.lg,
    padding: spacing.md,
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  cardTitle: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.gray800,
    marginBottom: spacing.md,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.gray100,
  },
  rowLabel: {
    fontSize: fontSize.sm,
    color: colors.gray500,
    flex: 1,
  },
  rowValue: {
    fontSize: fontSize.sm,
    color: colors.gray900,
    fontWeight: '500',
    flex: 2,
    textAlign: 'right',
  },
  rowValueMono: {
    fontFamily: 'monospace',
    letterSpacing: 0.5,
  },
});
