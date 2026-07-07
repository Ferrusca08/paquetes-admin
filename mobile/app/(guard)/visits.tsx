import { useState, useCallback, useRef } from 'react';
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
  Modal,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Feather } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import { generateClient } from 'aws-amplify/api';
import { useAuth } from '../../lib/hooks/useAuth';
import {
  searchResidents,
  listResidents,
  getUploadUrl,
  processLabel,
  checkInVisit,
  checkOutVisit,
} from '../../lib/graphql/operations';
import { colors, spacing, fontSize, radius } from '../../lib/theme';

const BADGE_BASE_URL =
  process.env.EXPO_PUBLIC_BADGE_BASE_URL ??
  'https://ferrusca08.github.io/paquetes-admin/badge.html';

type Resident = {
  id: string;
  fullName: string;
  towerName?: string;
  unitNumber?: string;
  towerId: string;
  unitId: string;
};

type Badge = {
  visitorName: string;
  towerName?: string;
  unitNumber?: string;
  badgeToken: string;
};

const client = generateClient();

export default function VisitsScreen() {
  const { user } = useAuth();

  // Step 1 — ID photo + OCR
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [visitorName, setVisitorName] = useState('');
  const [nameCandidates, setNameCandidates] = useState<string[]>([]);

  // Step 2 — destination department (search residents/units)
  const [query, setQuery] = useState('');
  const [residents, setResidents] = useState<Resident[]>([]);
  const [selected, setSelected] = useState<Resident | null>(null);
  const [searching, setSearching] = useState(false);

  // Badge result
  const [submitting, setSubmitting] = useState(false);
  const [badge, setBadge] = useState<Badge | null>(null);

  // Check-out scanner
  const [scannerOpen, setScannerOpen] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [checkingOut, setCheckingOut] = useState(false);
  // Synchronous lock: onBarcodeScanned fires many times/sec; state guards lag.
  const scannedRef = useRef(false);
  // True while the name field still holds the untouched OCR auto-guess.
  const autoFilledRef = useRef(false);

  // ─── Department search ─────────────────────────────────────

  const selectResident = (r: Resident) => {
    setSelected(r);
    setResidents([]);
    setQuery(r.fullName);
  };

  const runSearch = useCallback(
    async (name: string) => {
      if (!user?.buildingId || name.trim().length < 2) return;
      setSearching(true);
      try {
        const result = await client.graphql({
          query: searchResidents,
          variables: { buildingId: user.buildingId, query: name.trim(), limit: 10 },
        });
        const items = (result as { data: { searchResidents: { items: Resident[] } } })
          .data.searchResidents.items;
        setResidents(items);
      } catch {
        Alert.alert('Error', 'No se pudo buscar el departamento');
      } finally {
        setSearching(false);
      }
    },
    [user?.buildingId],
  );

  // Match a resident/department by unit number (auto-select on unique match).
  const matchByUnit = useCallback(
    async (unit: string): Promise<boolean> => {
      if (!user?.buildingId) return false;
      const norm = (s?: string) => (s ?? '').toString().trim().toUpperCase();
      try {
        const result = await client.graphql({
          query: listResidents,
          variables: { buildingId: user.buildingId, limit: 500 },
        });
        const all = (result as { data: { listResidents: { items: Resident[] } } })
          .data.listResidents.items;
        const matches = all.filter((r) => norm(r.unitNumber) === norm(unit));
        if (matches.length === 1) {
          selectResident(matches[0]);
          return true;
        }
        if (matches.length > 1) {
          setResidents(matches);
          return true;
        }
        return false;
      } catch {
        return false;
      }
    },
    [user?.buildingId],
  );

  // ─── ID photo & OCR ────────────────────────────────────────

  const pickPhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permiso requerido', 'Necesitamos la cámara para fotografiar la identificación.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.8, allowsEditing: false });
    if (result.canceled || !result.assets[0]) return;
    const uri = result.assets[0].uri;
    setPhotoUri(uri);
    await uploadAndOcr(uri);
  };

  const uploadAndOcr = async (uri: string) => {
    if (!user?.buildingId) {
      Alert.alert('Sin edificio asignado', 'Tu usuario no tiene un edificio asignado.');
      return;
    }
    setOcrLoading(true);
    try {
      // 1 — presigned URL (purpose "id")
      const urlResult = await client.graphql({
        query: getUploadUrl,
        variables: {
          input: { buildingId: user.buildingId, fileExtension: 'jpg', purpose: 'id' },
        },
      });
      const { uploadUrl, key } = (urlResult as {
        data: { getUploadUrl: { uploadUrl: string; key: string } };
      }).data.getUploadUrl;

      // 2 — upload to S3
      const photoResponse = await fetch(uri);
      const blob = await photoResponse.blob();
      await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/jpeg' },
        body: blob,
      });

      // 3 — OCR (docType "id" → extracts name, then deletes the photo server-side)
      const ocrRes = await client.graphql({
        query: processLabel,
        variables: { input: { s3Key: key, docType: 'id' } },
      });
      const ocr = (ocrRes as {
        data: { processLabel: { suggestedName?: string; nameCandidates?: string[] } };
      }).data.processLabel;
      setNameCandidates(ocr.nameCandidates ?? []);
      if (ocr.suggestedName) {
        setVisitorName(ocr.suggestedName);
        autoFilledRef.current = true; // first chip tap will replace this guess
      } else if (!ocr.nameCandidates?.length) {
        Alert.alert('No se leyó el nombre', 'Escríbelo manualmente abajo.');
      }
    } catch {
      Alert.alert('OCR falló', 'No se pudo leer la identificación. Escribe el nombre manualmente.');
    } finally {
      setOcrLoading(false);
    }
  };

  // ─── Generate badge (check-in) ─────────────────────────────

  const handleGenerate = async () => {
    if (!visitorName.trim()) {
      Alert.alert('Falta el nombre', 'Captura el nombre del visitante.');
      return;
    }
    if (!selected) {
      Alert.alert('Falta el departamento', 'Selecciona el departamento que va a visitar.');
      return;
    }
    if (!user?.buildingId) return;

    setSubmitting(true);
    try {
      const result = await client.graphql({
        query: checkInVisit,
        variables: {
          input: {
            buildingId: user.buildingId,
            visitorName: visitorName.trim(),
            towerId: selected.towerId,
            unitId: selected.unitId,
            residentId: selected.id,
          },
        },
      });
      const v = (result as { data: { checkInVisit: Badge } }).data.checkInVisit;
      setBadge(v);
    } catch {
      Alert.alert('Error', 'No se pudo generar el gafete. Intenta de nuevo.');
    } finally {
      setSubmitting(false);
    }
  };

  // Build the name from detected fragments. The first tap after an OCR
  // auto-guess REPLACES it (the guess is often wrong / has extra text); further
  // taps append, so the guard taps the parts in order (apellidos + nombres).
  const addCandidate = (c: string) => {
    setVisitorName((prev) => {
      if (autoFilledRef.current) {
        autoFilledRef.current = false;
        return c;
      }
      return prev.trim().length ? `${prev.trim()} ${c}` : c;
    });
  };

  const resetForm = () => {
    setPhotoUri(null);
    setVisitorName('');
    setNameCandidates([]);
    autoFilledRef.current = false;
    setQuery('');
    setResidents([]);
    setSelected(null);
    setBadge(null);
  };

  // ─── Check-out (scan visitor's QR) ─────────────────────────

  const openScanner = async () => {
    if (!permission?.granted) {
      const res = await requestPermission();
      if (!res.granted) {
        Alert.alert('Permiso requerido', 'Necesitamos la cámara para escanear el gafete de salida.');
        return;
      }
    }
    scannedRef.current = false; // arm the scanner
    setScannerOpen(true);
  };

  const onScan = async (data: string) => {
    // Synchronous lock — the camera fires this many times for the same QR.
    if (scannedRef.current) return;
    scannedRef.current = true;
    setScannerOpen(false);
    setCheckingOut(true);
    // The QR encodes the badge URL (…#<token>) or the raw token.
    const token = data.includes('#') ? data.split('#').pop()! : data.trim();
    try {
      const result = await client.graphql({
        query: checkOutVisit,
        variables: { token },
      });
      const v = (result as { data: { checkOutVisit: { visitorName: string } } })
        .data.checkOutVisit;
      Alert.alert('Visita finalizada', `${v.visitorName} salió del edificio.`);
    } catch {
      Alert.alert('Error', 'No se pudo finalizar la visita. QR inválido o ya finalizada.');
    } finally {
      setCheckingOut(false);
    }
  };

  // ─── Render: badge result ──────────────────────────────────

  if (badge) {
    const badgeUrl = `${BADGE_BASE_URL}#${badge.badgeToken}`;
    return (
      <ScrollView style={styles.container} contentContainerStyle={[styles.content, styles.badgeCenter]}>
        <View style={styles.badgeCard}>
          <Text style={styles.badgeTitle}>Gafete generado</Text>
          <Text style={styles.badgeName}>{badge.visitorName}</Text>
          <Text style={styles.badgeDept}>
            {[badge.towerName, badge.unitNumber ? `Depto ${badge.unitNumber}` : '']
              .filter(Boolean)
              .join(' · ')}
          </Text>
          <View style={styles.qrWrap}>
            <QRCode value={badgeUrl} size={220} />
          </View>
          <Text style={styles.badgeHint}>
            Pide al visitante que escanee este código con la cámara de su teléfono para abrir su
            gafete virtual.
          </Text>
        </View>
        <TouchableOpacity style={styles.primaryButton} onPress={resetForm} activeOpacity={0.8}>
          <Text style={styles.primaryButtonText}>Nueva visita</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  // ─── Render: check-in form ─────────────────────────────────

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <TouchableOpacity style={styles.scanOutButton} onPress={openScanner} activeOpacity={0.8}>
        <Feather name="log-out" size={18} color={colors.primary} />
        <Text style={styles.scanOutText}>Escanear salida de visita</Text>
      </TouchableOpacity>

      {/* STEP 1 — ID photo */}
      <SectionHeader number="1" title="Identificación" />

      {photoUri ? (
        <View style={styles.photoContainer}>
          <Image source={{ uri: photoUri }} style={styles.photo} resizeMode="cover" />
          {ocrLoading && (
            <View style={styles.ocrOverlay}>
              <ActivityIndicator color={colors.white} />
              <Text style={styles.ocrOverlayText}>Leyendo identificación...</Text>
            </View>
          )}
          <TouchableOpacity style={styles.retakeButton} onPress={pickPhoto}>
            <Text style={styles.retakeText}>Retomar foto</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity style={styles.photoPlaceholder} onPress={pickPhoto} activeOpacity={0.7}>
          <Feather name="credit-card" size={36} color={colors.gray400} style={styles.photoIcon} />
          <Text style={styles.photoText}>Tomar foto de la identificación</Text>
          <Text style={styles.photoSubtext}>El OCR extrae el nombre. La foto no se guarda.</Text>
        </TouchableOpacity>
      )}

      <Text style={styles.label}>Nombre del visitante</Text>
      <TextInput
        style={styles.input}
        value={visitorName}
        onChangeText={(t) => {
          setVisitorName(t);
          autoFilledRef.current = false; // manual edit → no longer the OCR guess
        }}
        placeholder="Detectado del OCR o escríbelo..."
        placeholderTextColor={colors.gray400}
        autoCapitalize="words"
      />

      {nameCandidates.length > 0 && (
        <View style={styles.chipsBlock}>
          <View style={styles.chipsHeader}>
            <Text style={styles.chipsHint}>¿El nombre no es correcto? Toca las partes correctas:</Text>
            {visitorName.length > 0 && (
              <TouchableOpacity onPress={() => setVisitorName('')}>
                <Text style={styles.chipsClear}>Limpiar</Text>
              </TouchableOpacity>
            )}
          </View>
          <View style={styles.chips}>
            {nameCandidates.map((c, i) => (
              <TouchableOpacity key={`${c}-${i}`} style={styles.chip} onPress={() => addCandidate(c)}>
                <Text style={styles.chipText}>{c}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {/* STEP 2 — Destination department */}
      <SectionHeader number="2" title="Departamento a visitar" />

      <TextInput
        style={styles.input}
        value={query}
        onChangeText={(t) => {
          setQuery(t);
          setSelected(null);
        }}
        placeholder="Busca por residente o número de depto..."
        placeholderTextColor={colors.gray400}
        returnKeyType="search"
        onSubmitEditing={() => (/^\d+$/.test(query.trim()) ? matchByUnit(query.trim()) : runSearch(query))}
      />
      <TouchableOpacity
        style={[styles.secondaryButton, searching && styles.disabled]}
        onPress={() => (/^\d+$/.test(query.trim()) ? matchByUnit(query.trim()) : runSearch(query))}
        disabled={searching}
        activeOpacity={0.7}
      >
        {searching ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <Text style={styles.secondaryButtonText}>Buscar</Text>
        )}
      </TouchableOpacity>

      {residents.length > 0 && !selected && (
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

      {selected && (
        <View style={styles.selectedCard}>
          <Text style={styles.selectedName}>
            <Feather name="check" size={14} color={colors.primaryDark} /> {selected.fullName}
          </Text>
          <Text style={styles.selectedUnit}>
            {[selected.towerName, selected.unitNumber ? `Depto ${selected.unitNumber}` : '']
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </View>
      )}

      <TouchableOpacity
        style={[styles.primaryButton, (!visitorName.trim() || !selected || submitting) && styles.disabled]}
        onPress={handleGenerate}
        disabled={!visitorName.trim() || !selected || submitting}
        activeOpacity={0.8}
      >
        {submitting ? (
          <ActivityIndicator color={colors.white} />
        ) : (
          <Text style={styles.primaryButtonText}>Generar gafete</Text>
        )}
      </TouchableOpacity>

      {/* Check-out scanner */}
      <Modal visible={scannerOpen} animationType="slide" onRequestClose={() => setScannerOpen(false)}>
        <View style={styles.scannerContainer}>
          <CameraView
            style={StyleSheet.absoluteFill}
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={({ data }) => onScan(data)}
          />
          <View style={styles.scannerOverlay}>
            <Text style={styles.scannerText}>Escanea el QR de salida del visitante</Text>
            {checkingOut && <ActivityIndicator color={colors.white} style={{ marginTop: spacing.md }} />}
          </View>
          <TouchableOpacity style={styles.scannerClose} onPress={() => setScannerOpen(false)}>
            <Text style={styles.scannerCloseText}>Cancelar</Text>
          </TouchableOpacity>
        </View>
      </Modal>
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
  scanOutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderWidth: 1.5,
    borderColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 12,
    marginBottom: spacing.sm,
  },
  scanOutText: { color: colors.primary, fontSize: fontSize.base, fontWeight: '700' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.lg, marginBottom: spacing.sm },
  sectionNumber: {
    width: 24,
    height: 24,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.sm,
  },
  sectionNumberText: { color: colors.white, fontSize: fontSize.xs, fontWeight: '700' },
  sectionTitle: { fontSize: fontSize.md, fontWeight: '600', color: colors.gray800 },
  label: { fontSize: fontSize.sm, fontWeight: '600', color: colors.gray700, marginBottom: 6, marginTop: spacing.sm },
  input: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.gray200,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: fontSize.base,
    color: colors.gray900,
  },
  chipsBlock: { marginTop: spacing.sm },
  chipsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  chipsHint: { fontSize: fontSize.xs, color: colors.gray500, flex: 1 },
  chipsClear: { fontSize: fontSize.xs, color: colors.primary, fontWeight: '700', marginLeft: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.gray300,
    borderRadius: radius.full,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chipText: { fontSize: fontSize.sm, color: colors.gray800, fontWeight: '500' },
  secondaryButton: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  secondaryButtonText: { color: colors.primary, fontSize: fontSize.base, fontWeight: '600' },
  dropdown: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.gray200,
    borderRadius: radius.md,
    marginTop: spacing.xs,
    overflow: 'hidden',
  },
  dropdownItem: { padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.gray100 },
  dropdownName: { fontSize: fontSize.base, fontWeight: '600', color: colors.gray900 },
  dropdownUnit: { fontSize: fontSize.sm, color: colors.gray500, marginTop: 2 },
  selectedCard: { backgroundColor: colors.primaryLight, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.sm },
  selectedName: { fontSize: fontSize.base, fontWeight: '600', color: colors.primaryDark },
  selectedUnit: { fontSize: fontSize.sm, color: colors.primaryDark, opacity: 0.8, marginTop: 2 },
  photoPlaceholder: {
    backgroundColor: colors.white,
    borderWidth: 2,
    borderColor: colors.gray200,
    borderStyle: 'dashed',
    borderRadius: radius.md,
    paddingVertical: spacing.xl,
    alignItems: 'center',
  },
  photoIcon: { marginBottom: spacing.sm },
  photoText: { fontSize: fontSize.base, fontWeight: '600', color: colors.gray700 },
  photoSubtext: { fontSize: fontSize.sm, color: colors.gray400, marginTop: 4 },
  photoContainer: { borderRadius: radius.md, overflow: 'hidden', position: 'relative' },
  photo: { width: '100%', height: 200 },
  ocrOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
  },
  ocrOverlayText: { color: colors.white, fontSize: fontSize.base },
  retakeButton: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    backgroundColor: colors.white,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  retakeText: { fontSize: fontSize.xs, color: colors.gray700, fontWeight: '600' },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  primaryButtonText: { color: colors.white, fontSize: fontSize.md, fontWeight: '700' },
  disabled: { opacity: 0.5 },
  // Badge result
  badgeCenter: { alignItems: 'center' },
  badgeCard: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: spacing.lg,
    alignItems: 'center',
    width: '100%',
    borderWidth: 1,
    borderColor: colors.gray200,
    marginTop: spacing.md,
  },
  badgeTitle: { fontSize: fontSize.sm, fontWeight: '700', color: colors.success, textTransform: 'uppercase', letterSpacing: 1 },
  badgeName: { fontSize: fontSize.xl, fontWeight: '800', color: colors.gray900, marginTop: spacing.sm, textAlign: 'center' },
  badgeDept: { fontSize: fontSize.base, color: colors.gray600, marginTop: 4, marginBottom: spacing.lg },
  qrWrap: { padding: spacing.md, backgroundColor: colors.white, borderRadius: radius.md },
  badgeHint: { fontSize: fontSize.sm, color: colors.gray500, textAlign: 'center', marginTop: spacing.lg },
  // Scanner
  scannerContainer: { flex: 1, backgroundColor: colors.black },
  scannerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scannerText: {
    color: colors.white,
    fontSize: fontSize.md,
    fontWeight: '600',
    backgroundColor: 'rgba(0,0,0,0.5)',
    padding: spacing.md,
    borderRadius: radius.md,
    textAlign: 'center',
  },
  scannerClose: {
    position: 'absolute',
    bottom: 40,
    alignSelf: 'center',
    backgroundColor: colors.white,
    paddingHorizontal: spacing.xl,
    paddingVertical: 12,
    borderRadius: radius.full,
  },
  scannerCloseText: { color: colors.gray900, fontSize: fontSize.base, fontWeight: '700' },
});
