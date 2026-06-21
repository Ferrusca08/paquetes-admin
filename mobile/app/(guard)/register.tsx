import { useState, useCallback } from 'react';
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
  searchResidents,
  getUploadUrl,
  processLabel,
  registerPackage,
} from '../../lib/graphql/operations';
import { colors, spacing, fontSize, radius } from '../../lib/theme';

type Resident = {
  id: string;
  fullName: string;
  towerName?: string;
  unitNumber?: string;
  towerId: string;
  unitId: string;
};

type OCRResult = {
  suggestedName?: string;
  suggestedTrackingNumber?: string;
  suggestedCarrier?: string;
  confidence?: number;
};

const client = generateClient();

export default function RegisterPackageScreen() {
  const { user } = useAuth();

  // Step 1 — resident search
  const [query, setQuery] = useState('');
  const [residents, setResidents] = useState<Resident[]>([]);
  const [selectedResident, setSelectedResident] = useState<Resident | null>(null);
  const [searching, setSearching] = useState(false);

  // Step 2 — photo + OCR
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoKey, setPhotoKey] = useState<string | null>(null);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrResult, setOcrResult] = useState<OCRResult | null>(null);

  // Step 3 — package data
  const [carrier, setCarrier] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');

  // Submission
  const [submitting, setSubmitting] = useState(false);

  // ─── Resident search ──────────────────────────────────────

  const handleSearch = useCallback(async () => {
    if (!user?.buildingId || query.trim().length < 2) return;
    setSearching(true);
    try {
      const result = await client.graphql({
        query: searchResidents,
        variables: { buildingId: user.buildingId, query: query.trim(), limit: 10 },
      });
      const items = (result as { data: { searchResidents: { items: Resident[] } } })
        .data.searchResidents.items;
      setResidents(items);
    } catch {
      Alert.alert('Error', 'No se pudo buscar residentes');
    } finally {
      setSearching(false);
    }
  }, [user?.buildingId, query]);

  const selectResident = (r: Resident) => {
    setSelectedResident(r);
    setResidents([]);
    setQuery(r.fullName);
  };

  // ─── Photo & OCR ──────────────────────────────────────────

  const pickPhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permiso requerido', 'Necesitamos acceso a la cámara para tomar la foto de la etiqueta.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      quality: 0.8,
      allowsEditing: false,
    });
    if (result.canceled || !result.assets[0]) return;

    const uri = result.assets[0].uri;
    setPhotoUri(uri);
    await uploadAndOcr(uri);
  };

  const uploadAndOcr = async (uri: string) => {
    if (!user?.buildingId) return;
    setOcrLoading(true);
    try {
      // 1 — Get presigned URL
      const urlResult = await client.graphql({
        query: getUploadUrl,
        variables: {
          input: { buildingId: user.buildingId, fileExtension: 'jpg', purpose: 'label' },
        },
      });
      const { uploadUrl, key } = (urlResult as {
        data: { getUploadUrl: { uploadUrl: string; key: string } };
      }).data.getUploadUrl;

      // 2 — Upload to S3
      const photoResponse = await fetch(uri);
      const blob = await photoResponse.blob();
      await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/jpeg' },
        body: blob,
      });
      setPhotoKey(key);

      // 3 — Run OCR
      const ocrRes = await client.graphql({
        query: processLabel,
        variables: { input: { s3Key: key } },
      });
      const ocr = (ocrRes as { data: { processLabel: OCRResult } }).data.processLabel;
      setOcrResult(ocr);

      // Auto-fill fields from OCR
      if (ocr.suggestedCarrier) setCarrier(ocr.suggestedCarrier);
      if (ocr.suggestedTrackingNumber) setTrackingNumber(ocr.suggestedTrackingNumber);
    } catch {
      Alert.alert('OCR falló', 'Puedes continuar sin foto o ingresando los datos manualmente.');
    } finally {
      setOcrLoading(false);
    }
  };

  // ─── Submit ───────────────────────────────────────────────

  const handleSubmit = async () => {
    if (!selectedResident) {
      Alert.alert('Falta residente', 'Selecciona al residente del paquete');
      return;
    }
    if (!user?.buildingId) return;

    setSubmitting(true);
    try {
      const result = await client.graphql({
        query: registerPackage,
        variables: {
          input: {
            buildingId: user.buildingId,
            towerId: selectedResident.towerId,
            unitId: selectedResident.unitId,
            residentId: selectedResident.id,
            carrier: carrier || undefined,
            trackingNumber: trackingNumber || undefined,
            labelPhotoKey: photoKey || undefined,
          },
        },
      });
      const pkg = (result as { data: { registerPackage: { pickupCode: string; residentName: string } } })
        .data.registerPackage;

      Alert.alert(
        '✅ Paquete registrado',
        `Residente: ${pkg.residentName}\n\nCódigo de retiro:\n\n${pkg.pickupCode}`,
        [{ text: 'Listo', onPress: resetForm }],
      );
    } catch (e) {
      Alert.alert('Error', 'No se pudo registrar el paquete. Intenta de nuevo.');
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setQuery('');
    setSelectedResident(null);
    setResidents([]);
    setPhotoUri(null);
    setPhotoKey(null);
    setOcrResult(null);
    setCarrier('');
    setTrackingNumber('');
  };

  // ─── Render ───────────────────────────────────────────────

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

      {/* STEP 1 — Resident */}
      <SectionHeader number="1" title="Residente destinatario" />

      <TextInput
        style={styles.input}
        value={query}
        onChangeText={(t) => { setQuery(t); setSelectedResident(null); }}
        placeholder="Buscar por nombre..."
        placeholderTextColor={colors.gray400}
        returnKeyType="search"
        onSubmitEditing={handleSearch}
      />
      <TouchableOpacity
        style={[styles.secondaryButton, searching && styles.disabled]}
        onPress={handleSearch}
        disabled={searching}
        activeOpacity={0.7}
      >
        {searching
          ? <ActivityIndicator size="small" color={colors.primary} />
          : <Text style={styles.secondaryButtonText}>Buscar</Text>}
      </TouchableOpacity>

      {residents.length > 0 && !selectedResident && (
        <View style={styles.dropdown}>
          {residents.map((r) => (
            <TouchableOpacity key={r.id} style={styles.dropdownItem} onPress={() => selectResident(r)}>
              <Text style={styles.dropdownName}>{r.fullName}</Text>
              <Text style={styles.dropdownUnit}>
                {[r.towerName, r.unitNumber ? `Depto ${r.unitNumber}` : ''].filter(Boolean).join(' · ')}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {selectedResident && (
        <View style={styles.selectedCard}>
          <Text style={styles.selectedName}>✓ {selectedResident.fullName}</Text>
          <Text style={styles.selectedUnit}>
            {[selectedResident.towerName, selectedResident.unitNumber ? `Depto ${selectedResident.unitNumber}` : ''].filter(Boolean).join(' · ')}
          </Text>
        </View>
      )}

      {/* STEP 2 — Photo */}
      <SectionHeader number="2" title="Foto de etiqueta (opcional)" />

      {photoUri ? (
        <View style={styles.photoContainer}>
          <Image source={{ uri: photoUri }} style={styles.photo} resizeMode="cover" />
          {ocrLoading && (
            <View style={styles.ocrOverlay}>
              <ActivityIndicator color={colors.white} />
              <Text style={styles.ocrOverlayText}>Procesando OCR...</Text>
            </View>
          )}
          {ocrResult && !ocrLoading && (
            <View style={styles.ocrBadge}>
              <Text style={styles.ocrBadgeText}>
                OCR: {Math.round((ocrResult.confidence ?? 0) * 100)}% confianza
              </Text>
            </View>
          )}
          <TouchableOpacity style={styles.retakeButton} onPress={pickPhoto}>
            <Text style={styles.retakeText}>Retomar foto</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity style={styles.photoPlaceholder} onPress={pickPhoto} activeOpacity={0.7}>
          <Text style={styles.photoIcon}>📷</Text>
          <Text style={styles.photoText}>Tomar foto de etiqueta</Text>
          <Text style={styles.photoSubtext}>El OCR llenará datos automáticamente</Text>
        </TouchableOpacity>
      )}

      {/* STEP 3 — Package data */}
      <SectionHeader number="3" title="Datos del paquete" />

      <Text style={styles.label}>Transportista</Text>
      <TextInput
        style={styles.input}
        value={carrier}
        onChangeText={setCarrier}
        placeholder="FedEx, UPS, DHL, Amazon..."
        placeholderTextColor={colors.gray400}
      />

      <Text style={styles.label}>Número de rastreo</Text>
      <TextInput
        style={styles.input}
        value={trackingNumber}
        onChangeText={setTrackingNumber}
        placeholder="Número de tracking (opcional)"
        placeholderTextColor={colors.gray400}
        autoCapitalize="characters"
      />

      {/* Submit */}
      <TouchableOpacity
        style={[styles.primaryButton, (!selectedResident || submitting) && styles.disabled]}
        onPress={handleSubmit}
        disabled={!selectedResident || submitting}
        activeOpacity={0.8}
      >
        {submitting
          ? <ActivityIndicator color={colors.white} />
          : <Text style={styles.primaryButtonText}>Registrar paquete</Text>}
      </TouchableOpacity>
    </ScrollView>
  );
}

function SectionHeader({ number, title }: { number: string; title: string }) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionNumber}>
        <Text style={styles.sectionNumberText}>{number}</Text>
      </View>
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.gray50 },
  content: { padding: spacing.md, paddingBottom: spacing.xxl },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.lg, marginBottom: spacing.sm },
  sectionNumber: {
    width: 24, height: 24, borderRadius: radius.full,
    backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center',
    marginRight: spacing.sm,
  },
  sectionNumberText: { color: colors.white, fontSize: fontSize.xs, fontWeight: '700' },
  sectionTitle: { fontSize: fontSize.md, fontWeight: '600', color: colors.gray800 },
  label: { fontSize: fontSize.sm, fontWeight: '600', color: colors.gray700, marginBottom: 6, marginTop: spacing.sm },
  input: {
    backgroundColor: colors.white,
    borderWidth: 1, borderColor: colors.gray200,
    borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 12,
    fontSize: fontSize.base, color: colors.gray900,
  },
  secondaryButton: {
    borderWidth: 1, borderColor: colors.primary,
    borderRadius: radius.md, paddingVertical: 10,
    alignItems: 'center', marginTop: spacing.sm,
  },
  secondaryButtonText: { color: colors.primary, fontSize: fontSize.base, fontWeight: '600' },
  dropdown: {
    backgroundColor: colors.white, borderWidth: 1, borderColor: colors.gray200,
    borderRadius: radius.md, marginTop: spacing.xs, overflow: 'hidden',
  },
  dropdownItem: {
    padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.gray100,
  },
  dropdownName: { fontSize: fontSize.base, fontWeight: '600', color: colors.gray900 },
  dropdownUnit: { fontSize: fontSize.sm, color: colors.gray500, marginTop: 2 },
  selectedCard: {
    backgroundColor: colors.primaryLight, borderRadius: radius.md,
    padding: spacing.md, marginTop: spacing.sm,
  },
  selectedName: { fontSize: fontSize.base, fontWeight: '600', color: colors.primaryDark },
  selectedUnit: { fontSize: fontSize.sm, color: colors.primaryDark, opacity: 0.8, marginTop: 2 },
  photoPlaceholder: {
    backgroundColor: colors.white, borderWidth: 2, borderColor: colors.gray200,
    borderStyle: 'dashed', borderRadius: radius.md,
    paddingVertical: spacing.xl, alignItems: 'center',
  },
  photoIcon: { fontSize: 36, marginBottom: spacing.sm },
  photoText: { fontSize: fontSize.base, fontWeight: '600', color: colors.gray700 },
  photoSubtext: { fontSize: fontSize.sm, color: colors.gray400, marginTop: 4 },
  photoContainer: { borderRadius: radius.md, overflow: 'hidden', position: 'relative' },
  photo: { width: '100%', height: 200 },
  ocrOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center', alignItems: 'center', gap: spacing.sm,
  },
  ocrOverlayText: { color: colors.white, fontSize: fontSize.base },
  ocrBadge: {
    position: 'absolute', bottom: 8, left: 8,
    backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: radius.sm,
    paddingHorizontal: 8, paddingVertical: 4,
  },
  ocrBadgeText: { color: colors.white, fontSize: fontSize.xs, fontWeight: '600' },
  retakeButton: {
    position: 'absolute', bottom: 8, right: 8,
    backgroundColor: colors.white, borderRadius: radius.sm,
    paddingHorizontal: 10, paddingVertical: 5,
  },
  retakeText: { fontSize: fontSize.xs, color: colors.gray700, fontWeight: '600' },
  primaryButton: {
    backgroundColor: colors.primary, borderRadius: radius.md,
    paddingVertical: 14, alignItems: 'center', marginTop: spacing.xl,
  },
  primaryButtonText: { color: colors.white, fontSize: fontSize.md, fontWeight: '700' },
  disabled: { opacity: 0.5 },
});
