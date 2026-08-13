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
  Linking,
  RefreshControl,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { generateClient } from 'aws-amplify/api';
import { useAuth } from '../../lib/hooks/useAuth';
import {
  listAnnouncements,
  listDocuments,
  getDocumentUrl,
  listMyReports,
  createReport,
} from '../../lib/graphql/operations';
import { colors, spacing, fontSize, radius } from '../../lib/theme';

type Announcement = { id: string; title: string; body: string; createdAt: string };
type Doc = { id: string; title: string; createdAt: string };
type Report = { id: string; category: string; description: string; status: string; createdAt: string };

const client = generateClient();
const CATEGORIES = ['Mantenimiento', 'Seguridad', 'Limpieza', 'Ruido', 'Otro'];

function fmt(d: string) {
  return new Date(d).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function CommunityScreen() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [reports, setReports] = useState<Report[]>([]);

  // Report form
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!user?.buildingId) return;
    try {
      const [a, d, r] = await Promise.all([
        client.graphql({ query: listAnnouncements, variables: { buildingId: user.buildingId } }) as Promise<{ data: { listAnnouncements: { items: Announcement[] } } }>,
        client.graphql({ query: listDocuments, variables: { buildingId: user.buildingId } }) as Promise<{ data: { listDocuments: { items: Doc[] } } }>,
        user.residentId
          ? (client.graphql({ query: listMyReports, variables: { residentId: user.residentId } }) as Promise<{ data: { listMyReports: { items: Report[] } } }>)
          : Promise.resolve({ data: { listMyReports: { items: [] } } }),
      ]);
      setAnnouncements(a.data.listAnnouncements.items || []);
      setDocs(d.data.listDocuments.items || []);
      setReports(r.data.listMyReports.items || []);
    } catch {
      Alert.alert('Error', 'No se pudo cargar la comunidad');
    } finally {
      setLoading(false);
    }
  }, [user?.buildingId, user?.residentId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openDoc = async (id: string) => {
    if (!user?.buildingId) return;
    try {
      const res = (await client.graphql({
        query: getDocumentUrl,
        variables: { buildingId: user.buildingId, documentId: id },
      })) as { data: { getDocumentUrl: string } };
      const url = res.data.getDocumentUrl;
      if (url) Linking.openURL(url);
    } catch {
      Alert.alert('Error', 'No se pudo abrir el documento');
    }
  };

  const submitReport = async () => {
    if (!description.trim()) {
      Alert.alert('Falta descripción', 'Describe la incidencia.');
      return;
    }
    if (!user?.buildingId || !user?.residentId) return;
    setSubmitting(true);
    try {
      await client.graphql({
        query: createReport,
        variables: {
          input: { buildingId: user.buildingId, residentId: user.residentId, category, description: description.trim() },
        },
      });
      setDescription('');
      Alert.alert('Enviado', 'Tu incidencia fue reportada a la administración.');
      load();
    } catch {
      Alert.alert('Error', 'No se pudo enviar la incidencia');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}
      keyboardShouldPersistTaps="handled"
    >
      {/* Avisos */}
      <Text style={styles.section}>📣 Avisos</Text>
      {announcements.length === 0 ? (
        <Text style={styles.empty}>Sin avisos por ahora.</Text>
      ) : (
        announcements.map((a) => (
          <View key={a.id} style={styles.card}>
            <Text style={styles.cardTitle}>{a.title}</Text>
            <Text style={styles.cardDate}>{fmt(a.createdAt)}</Text>
            <Text style={styles.cardBody}>{a.body}</Text>
          </View>
        ))
      )}

      {/* Documentos */}
      <Text style={styles.section}>📄 Documentos</Text>
      {docs.length === 0 ? (
        <Text style={styles.empty}>Sin documentos.</Text>
      ) : (
        docs.map((d) => (
          <TouchableOpacity key={d.id} style={styles.docRow} onPress={() => openDoc(d.id)}>
            <Feather name="file-text" size={18} color={colors.primary} />
            <Text style={styles.docTitle}>{d.title}</Text>
            <Feather name="external-link" size={16} color={colors.gray400} />
          </TouchableOpacity>
        ))
      )}

      {/* Reportar incidencia */}
      <Text style={styles.section}>⚠️ Reportar incidencia</Text>
      <View style={styles.chips}>
        {CATEGORIES.map((c) => (
          <TouchableOpacity
            key={c}
            style={[styles.chip, category === c && styles.chipActive]}
            onPress={() => setCategory(c)}
          >
            <Text style={[styles.chipText, category === c && styles.chipTextActive]}>{c}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <TextInput
        style={styles.input}
        value={description}
        onChangeText={setDescription}
        placeholder="Describe la incidencia..."
        placeholderTextColor={colors.gray400}
        multiline
      />
      <TouchableOpacity
        style={[styles.button, (submitting || !description.trim()) && styles.disabled]}
        onPress={submitReport}
        disabled={submitting || !description.trim()}
      >
        {submitting ? <ActivityIndicator color={colors.white} /> : <Text style={styles.buttonText}>Enviar incidencia</Text>}
      </TouchableOpacity>

      {reports.length > 0 && (
        <>
          <Text style={styles.section}>Mis incidencias</Text>
          {reports.map((r) => (
            <View key={r.id} style={styles.card}>
              <View style={styles.reportHead}>
                <Text style={styles.cardTitle}>{r.category}</Text>
                <View style={[styles.badge, r.status === 'RESOLVED' ? styles.badgeOk : styles.badgeOpen]}>
                  <Text style={[styles.badgeText, r.status === 'RESOLVED' ? styles.badgeTextOk : styles.badgeTextOpen]}>
                    {r.status === 'RESOLVED' ? 'Resuelto' : 'Abierto'}
                  </Text>
                </View>
              </View>
              <Text style={styles.cardDate}>{fmt(r.createdAt)}</Text>
              <Text style={styles.cardBody}>{r.description}</Text>
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.gray50 },
  content: { padding: spacing.md, paddingBottom: spacing.xxl },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.gray50 },
  section: { fontSize: fontSize.md, fontWeight: '700', color: colors.gray800, marginTop: spacing.lg, marginBottom: spacing.sm },
  empty: { color: colors.gray400, fontSize: fontSize.sm },
  card: { backgroundColor: colors.white, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.gray200 },
  cardTitle: { fontSize: fontSize.base, fontWeight: '700', color: colors.gray900 },
  cardDate: { fontSize: fontSize.xs, color: colors.gray400, marginTop: 2, marginBottom: 6 },
  cardBody: { fontSize: fontSize.sm, color: colors.gray700, lineHeight: 20 },
  docRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.white, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.xs, borderWidth: 1, borderColor: colors.gray200 },
  docTitle: { flex: 1, fontSize: fontSize.base, color: colors.gray900, fontWeight: '500' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.sm },
  chip: { borderWidth: 1, borderColor: colors.gray300, borderRadius: radius.full, paddingHorizontal: 12, paddingVertical: 7 },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: fontSize.sm, color: colors.gray700, fontWeight: '500' },
  chipTextActive: { color: colors.white },
  input: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.gray200, borderRadius: radius.md, padding: spacing.md, fontSize: fontSize.base, color: colors.gray900, minHeight: 80, textAlignVertical: 'top' },
  button: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', marginTop: spacing.sm },
  buttonText: { color: colors.white, fontSize: fontSize.md, fontWeight: '700' },
  disabled: { opacity: 0.5 },
  reportHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  badge: { borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 3 },
  badgeOpen: { backgroundColor: colors.warningLight },
  badgeOk: { backgroundColor: colors.successLight },
  badgeText: { fontSize: fontSize.xs, fontWeight: '700' },
  badgeTextOpen: { color: colors.warning },
  badgeTextOk: { color: colors.success },
});
