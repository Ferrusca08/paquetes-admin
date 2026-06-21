import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
  Image,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { generateClient } from 'aws-amplify/api';
import { useAuth } from '../../lib/hooks/useAuth';
import {
  verifyPickupCode,
  getUploadUrl,
  confirmPickup,
} from '../../lib/graphql/operations';
import { colors, spacing, fontSize, radius, statusConfig } from '../../lib/theme';

type VerifiedPackage = {
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
};

const client = generateClient();

export default function PickupScreen() {
  const { user } = useAuth();
  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [pkg, setPkg] = useState<VerifiedPackage | null>(null);

  const [evidenceUri, setEvidenceUri] = useState<string | null>(null);
  const [evidenceKey, setEvidenceKey] = useState<string | null>(null);
  const [uploadingEvidence, setUploadingEvidence] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // ─── Verify code ─────────────────────────────────────────

  const handleVerify = async () => {
    const trimmed = code.trim().toUpperCase();
    if (trimmed.length < 4) {
      Alert.alert('Código inválido', 'Ingresa el código completo');
      return;
    }
    setVerifying(true);
    setPkg(null);
    try {
      const result = await client.graphql({
        query: verifyPickupCode,
        variables: { code: trimmed },
      });
      const found = (result as { data: { verifyPickupCode: VerifiedPackage | null } })
        .data.verifyPickupCode;
      if (!found) {
        Alert.alert('No encontrado', 'El código no corresponde a ningún paquete pendiente');
      } else {
        setPkg(found);
      }
    } catch {
      Alert.alert('Error', 'No se pudo verificar el código');
    } finally {
      setVerifying(false);
    }
  };

  // ─── Evidence photo ───────────────────────────────────────

  const pickEvidence = async () => {
    if (!user?.buildingId) return;
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permiso requerido', 'Necesitamos la cámara para la foto de evidencia.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.8 });
    if (result.canceled || !result.assets[0]) return;

    const uri = result.assets[0].uri;
    setEvidenceUri(uri);
    setUploadingEvidence(true);
    try {
      const urlResult = await client.graphql({
        query: getUploadUrl,
        variables: {
          input: { buildingId: user.buildingId, fileExtension: 'jpg', purpose: 'evidence' },
        },
      });
      const { uploadUrl, key } = (urlResult as {
        data: { getUploadUrl: { uploadUrl: string; key: string } };
      }).data.getUploadUrl;

      const photoRes = await fetch(uri);
      const blob = await photoRes.blob();
      await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: blob });
      setEvidenceKey(key);
    } catch {
      Alert.alert('Error', 'No se pudo subir la foto de evidencia. El retiro se confirmará sin evidencia.');
      setEvidenceUri(null);
      setEvidenceKey(null);
    } finally {
      setUploadingEvidence(false);
    }
  };

  // ─── Confirm pickup ───────────────────────────────────────

  const handleConfirm = async () => {
    if (!pkg) return;
    Alert.alert(
      'Confirmar retiro',
      `¿Confirmar que ${pkg.residentName} retiró su paquete?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Confirmar',
          onPress: async () => {
            setConfirming(true);
            try {
              await client.graphql({
                query: confirmPickup,
                variables: {
                  input: {
                    buildingId: pkg.buildingId,
                    packageId: pkg.id,
                    pickupCode: pkg.pickupCode,
                    evidencePhotoKey: evidenceKey ?? undefined,
                  },
                },
              });
              Alert.alert('✅ Retiro confirmado', `Paquete de ${pkg.residentName} entregado exitosamente.`,
                [{ text: 'OK', onPress: resetForm }]);
            } catch {
              Alert.alert('Error', 'No se pudo confirmar el retiro. Verifica el código.');
            } finally {
              setConfirming(false);
            }
          },
        },
      ],
    );
  };

  const resetForm = () => {
    setCode('');
    setPkg(null);
    setEvidenceUri(null);
    setEvidenceKey(null);
  };

  // ─── Render ───────────────────────────────────────────────

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.sectionTitle}>Código de retiro</Text>

      <View style={styles.codeRow}>
        <TextInput
          style={styles.codeInput}
          value={code}
          onChangeText={(t) => { setCode(t.toUpperCase()); setPkg(null); }}
          placeholder="XXXXXX"
          placeholderTextColor={colors.gray400}
          maxLength={8}
          autoCapitalize="characters"
          keyboardType="default"
          returnKeyType="search"
          onSubmitEditing={handleVerify}
        />
        <TouchableOpacity
          style={[styles.verifyButton, (verifying || code.trim().length < 4) && styles.disabled]}
          onPress={handleVerify}
          disabled={verifying || code.trim().length < 4}
          activeOpacity={0.8}
        >
          {verifying
            ? <ActivityIndicator color={colors.white} size="small" />
            : <Text style={styles.verifyButtonText}>Verificar</Text>}
        </TouchableOpacity>
      </View>

      {/* Package preview */}
      {pkg && (
        <>
          <View style={styles.pkgCard}>
            <View style={styles.pkgHeader}>
              <Text style={styles.pkgResident}>{pkg.residentName}</Text>
              <View style={[styles.badge, { backgroundColor: statusConfig[pkg.status]?.bg }]}>
                <Text style={[styles.badgeText, { color: statusConfig[pkg.status]?.color }]}>
                  {statusConfig[pkg.status]?.label}
                </Text>
              </View>
            </View>

            {(pkg.towerName || pkg.unitNumber) && (
              <Text style={styles.pkgUnit}>
                {[pkg.towerName, pkg.unitNumber ? `Depto ${pkg.unitNumber}` : ''].filter(Boolean).join(' · ')}
              </Text>
            )}

            {pkg.carrier && (
              <Text style={styles.pkgMeta}>
                {pkg.carrier}{pkg.trackingNumber ? ` · ${pkg.trackingNumber}` : ''}
              </Text>
            )}

            <Text style={styles.pkgDate}>
              Registrado el {new Date(pkg.createdAt).toLocaleDateString('es-MX', {
                day: '2-digit', month: 'long', year: 'numeric',
              })}
            </Text>
          </View>

          {/* Evidence photo */}
          <Text style={styles.sectionTitle}>Foto de evidencia (opcional)</Text>

          {evidenceUri ? (
            <View style={styles.photoContainer}>
              <Image source={{ uri: evidenceUri }} style={styles.photo} resizeMode="cover" />
              {uploadingEvidence && (
                <View style={styles.overlay}>
                  <ActivityIndicator color={colors.white} />
                  <Text style={styles.overlayText}>Subiendo...</Text>
                </View>
              )}
              {!uploadingEvidence && (
                <TouchableOpacity style={styles.retakeButton} onPress={pickEvidence}>
                  <Text style={styles.retakeText}>Retomar</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            <TouchableOpacity style={styles.photoPlaceholder} onPress={pickEvidence} activeOpacity={0.7}>
              <Text style={styles.photoIcon}>📸</Text>
              <Text style={styles.photoText}>Tomar foto de evidencia</Text>
            </TouchableOpacity>
          )}

          {/* Confirm */}
          <TouchableOpacity
            style={[styles.confirmButton, (confirming || uploadingEvidence) && styles.disabled]}
            onPress={handleConfirm}
            disabled={confirming || uploadingEvidence}
            activeOpacity={0.8}
          >
            {confirming
              ? <ActivityIndicator color={colors.white} />
              : <Text style={styles.confirmButtonText}>✅ Confirmar retiro</Text>}
          </TouchableOpacity>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.gray50 },
  content: { padding: spacing.md, paddingBottom: spacing.xxl },
  sectionTitle: { fontSize: fontSize.md, fontWeight: '700', color: colors.gray800, marginBottom: spacing.sm, marginTop: spacing.lg },
  codeRow: { flexDirection: 'row', gap: spacing.sm },
  codeInput: {
    flex: 1,
    backgroundColor: colors.white, borderWidth: 1, borderColor: colors.gray200,
    borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 14,
    fontSize: fontSize.xl, fontWeight: '700', color: colors.gray900,
    letterSpacing: 4, textAlign: 'center',
  },
  verifyButton: {
    backgroundColor: colors.primary, borderRadius: radius.md,
    paddingHorizontal: spacing.md, justifyContent: 'center', alignItems: 'center', minWidth: 90,
  },
  verifyButtonText: { color: colors.white, fontSize: fontSize.base, fontWeight: '700' },
  pkgCard: {
    backgroundColor: colors.white, borderRadius: radius.md,
    padding: spacing.md, marginTop: spacing.md,
    shadowColor: colors.black, shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 6, elevation: 3,
  },
  pkgHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pkgResident: { fontSize: fontSize.lg, fontWeight: '700', color: colors.gray900, flex: 1 },
  badge: { borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 4, marginLeft: spacing.sm },
  badgeText: { fontSize: fontSize.xs, fontWeight: '600' },
  pkgUnit: { fontSize: fontSize.base, color: colors.gray600, marginTop: 6 },
  pkgMeta: { fontSize: fontSize.sm, color: colors.gray500, marginTop: 3 },
  pkgDate: { fontSize: fontSize.sm, color: colors.gray400, marginTop: spacing.sm },
  photoPlaceholder: {
    backgroundColor: colors.white, borderWidth: 2, borderColor: colors.gray200,
    borderStyle: 'dashed', borderRadius: radius.md,
    paddingVertical: spacing.lg, alignItems: 'center', marginTop: spacing.sm,
  },
  photoIcon: { fontSize: 32, marginBottom: 8 },
  photoText: { fontSize: fontSize.base, color: colors.gray600 },
  photoContainer: { borderRadius: radius.md, overflow: 'hidden', marginTop: spacing.sm },
  photo: { width: '100%', height: 180 },
  overlay: {
    ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center', alignItems: 'center', gap: 8,
  },
  overlayText: { color: colors.white, fontSize: fontSize.sm },
  retakeButton: {
    position: 'absolute', bottom: 8, right: 8,
    backgroundColor: colors.white, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 4,
  },
  retakeText: { fontSize: fontSize.xs, color: colors.gray700, fontWeight: '600' },
  confirmButton: {
    backgroundColor: colors.success, borderRadius: radius.md,
    paddingVertical: 16, alignItems: 'center', marginTop: spacing.xl,
  },
  confirmButtonText: { color: colors.white, fontSize: fontSize.md, fontWeight: '700' },
  disabled: { opacity: 0.5 },
});
