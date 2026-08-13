/**
 * PackTrack — processLabel Lambda Handler
 *
 * Processes a package label photo using Amazon Rekognition (DetectText) to
 * extract:
 * - Recipient name (suggested)
 * - Tower + unit/department (suggested)
 * - Tracking number (suggested)
 * - Carrier (detected)
 * - Raw OCR text
 * - Confidence score
 *
 * Rekognition is used instead of Textract because Textract is not enabled on
 * this account. DetectText reads text lines from the label image just as well
 * for this use case.
 *
 * The photo must already be uploaded to the PackTrack S3 bucket
 * (via the getUploadUrl → presigned PUT flow).
 */
import {
  RekognitionClient,
  DetectTextCommand,
  type TextDetection,
} from "@aws-sdk/client-rekognition";
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { BUCKET_NAME } from "../shared/constants.js";
import type { AppSyncResolverEvent } from "../shared/types.js";
import { ValidationError } from "../shared/errors.js";

const rekognition = new RekognitionClient({});
const s3 = new S3Client({});

// ─── Carrier Detection ───────────────────────────────────────────────────────

interface CarrierPattern {
  name: string;
  keywords: RegExp;
  trackingPattern: RegExp;
}

const CARRIERS: CarrierPattern[] = [
  {
    name: "FedEx",
    keywords: /\bfedex\b/i,
    trackingPattern: /\b(\d{12}|\d{15}|\d{20}|96\d{20})\b/,
  },
  {
    name: "UPS",
    keywords: /\bups\b/i,
    trackingPattern: /\b(1Z[A-Z0-9]{16})\b/i,
  },
  {
    name: "USPS",
    keywords: /\busps\b|united states postal/i,
    trackingPattern: /\b(94\d{20}|92\d{20}|91\d{20}|420\d{27})\b/,
  },
  {
    name: "DHL",
    keywords: /\bdhl\b/i,
    trackingPattern: /\b(\d{10,11}|[A-Z]{3}\d{7,10})\b/i,
  },
  {
    name: "Amazon",
    keywords: /\bamazon\b|amzn/i,
    trackingPattern: /\b(TBA\d{12}US?)\b/i,
  },
  // ── Mexican / LATAM carriers ──────────────────────────────────────────────
  {
    name: "Moova",
    keywords: /\bmoova\b|moova\.io/i,
    // Moova uses UUID-style tracking (e.g. 31873960-7340-11f1-869f-...).
    trackingPattern: /\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i,
  },
  {
    name: "Estafeta",
    keywords: /\bestafeta\b/i,
    trackingPattern: /\b(\d{10,12})\b/,
  },
  {
    name: "Mercado Envíos",
    keywords: /\bmercado\s*(env[ií]os|libre)\b|\bmeli\b/i,
    trackingPattern: /\b(\d{11,14})\b/,
  },
  {
    name: "99 Minutos",
    keywords: /\b99\s*minutos\b|\b99minutos\b/i,
    trackingPattern: /\b([A-Z0-9]{8,14})\b/i,
  },
  {
    name: "Correos de México",
    keywords: /\bcorreos de m[eé]xico\b|\bsepomex\b/i,
    trackingPattern: /\b([A-Z]{2}\d{9}[A-Z]{2})\b/i,
  },
  {
    name: "Paquetexpress",
    keywords: /\bpaquete\s*express\b|\bpaquetexpress\b/i,
    trackingPattern: /\b(\d{10,14})\b/,
  },
];

// ─── Address / Name Extraction ───────────────────────────────────────────────

const DELIVERY_PREFIXES = [
  /^(?:ship\s+)?to[:\s]+(.+)/i,
  /^deliver(?:ed)?\s+to[:\s]+(.+)/i,
  /^recipient[:\s]+(.+)/i,
  /^attn[.:\s]+(.+)/i,
  /^destinatario[:\s]+(.+)/i,
];

/**
 * Heuristic: find lines after "TO:" / "SHIP TO:" / "DELIVER TO:"
 * and return the first one that looks like a name (2–5 words, mostly letters).
 */
function extractRecipientName(lines: string[]): string | null {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Check if this line is a "TO:" marker
    for (const prefix of DELIVERY_PREFIXES) {
      const match = prefix.exec(line);
      if (match) {
        // Inline: "TO: John Doe"
        if (match[1]?.trim() && looksLikeName(match[1].trim())) {
          return capitalizeWords(match[1].trim());
        }
        // Next line: "TO:\nJohn Doe"
        const nextLine = lines[i + 1]?.trim();
        if (nextLine && looksLikeName(nextLine)) {
          return capitalizeWords(nextLine);
        }
      }
    }
  }
  return null;
}

function looksLikeName(text: string): boolean {
  const words = text.split(/\s+/);
  if (words.length < 2 || words.length > 6) return false;
  // Mostly alphabetic characters (allow hyphens and periods for abbreviations)
  return words.every((w) => /^[A-Za-záéíóúÁÉÍÓÚñÑüÜ.,'-]+$/.test(w));
}

// ─── ID Card Name Extraction (Mexican INE and similar) ───────────────────────

// Words that appear on an INE but are NOT part of the person's name.
const ID_KEYWORDS =
  /\b(instituto|nacional|electoral|credencial|para votar|nombre|domicilio|clave|curp|fecha|nacimiento|sexo|a[nñ]o|registro|estado|municipio|localidad|seccion|secci[oó]n|emision|emisi[oó]n|vigencia|mexico|m[eé]xico)\b/i;

/** A line that is a plausible fragment of a person's name (letters only). */
function looksLikeIdNameLine(line: string): boolean {
  const t = line.trim();
  if (t.length < 2 || /\d/.test(t)) return false;
  if (ID_KEYWORDS.test(t)) return false;
  return /^[A-Za-záéíóúÁÉÍÓÚñÑüÜ.'\- ]+$/.test(t) && t.replace(/\s/g, "").length >= 2;
}

/** A detected line with its normalized position on the card (0–1). */
interface LineBox {
  text: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Section labels that mark the END of the name block on an INE. */
const ID_SECTION_LABELS =
  /\b(domicilio|clave|curp|fecha|nacimiento|sexo|registro|estado|municipio|localidad|seccion|secci[oó]n|emision|emisi[oó]n|vigencia)\b/i;

function toLineBoxes(dets: TextDetection[]): LineBox[] {
  return dets
    .filter((d) => d.Type === "LINE" && d.DetectedText && d.Geometry?.BoundingBox)
    .map((d) => {
      const b = d.Geometry!.BoundingBox!;
      return {
        text: d.DetectedText!.trim(),
        left: b.Left ?? 0,
        top: b.Top ?? 0,
        width: b.Width ?? 0,
        height: b.Height ?? 0,
      };
    });
}

/**
 * Extract the visitor's name from an ID card using the spatial layout that
 * Rekognition reports (bounding boxes), not detection order — far more robust
 * on the INE, whose name sits as up to three stacked lines under the "NOMBRE"
 * label. Returns the best guess plus a list of plausible name lines so the
 * guard can tap the right ones when the guess is off.
 */
function extractIdName(dets: TextDetection[]): {
  suggestedName: string | null;
  nameCandidates: string[];
} {
  const boxes = toLineBoxes(dets);

  // All plausible name fragments (letters only, not keywords), top→bottom.
  // These feed the guard's tap-to-pick fallback.
  const nameCandidates = boxes
    .filter((b) => looksLikeIdNameLine(b.text))
    .sort((a, b) => a.top - b.top || a.left - b.left)
    .map((b) => capitalizeWords(b.text));

  // Anchor on the "NOMBRE" label's position.
  const label = boxes.find((b) => /^\s*nombre\b/i.test(b.text));
  if (label) {
    // Where does the name block end? The next section label below the anchor.
    const nextLabelTop = boxes
      .filter((b) => b.top > label.top + label.height * 0.3 && ID_SECTION_LABELS.test(b.text))
      .reduce((min, b) => Math.min(min, b.top), 1);

    const block = boxes
      .filter(
        (b) =>
          looksLikeIdNameLine(b.text) &&
          b.top >= label.top - label.height * 0.3 && // at or below the label
          b.top < nextLabelTop && // before the next section
          b.left >= label.left - 0.06, // roughly the label's column (allow drift)
      )
      .sort((a, b) => a.top - b.top || a.left - b.left)
      .slice(0, 3);

    if (block.length) {
      return { suggestedName: capitalizeWords(block.map((b) => b.text).join(" ")), nameCandidates };
    }
  }

  // Fallback: the top-most cluster of name-like lines in the card's left half.
  const cluster = boxes
    .filter((b) => looksLikeIdNameLine(b.text) && b.left < 0.6 && b.top < 0.6)
    .sort((a, b) => a.top - b.top || a.left - b.left)
    .slice(0, 3);
  const suggestedName = cluster.length
    ? capitalizeWords(cluster.map((b) => b.text).join(" "))
    : nameCandidates[0] ?? null;

  return { suggestedName, nameCandidates };
}

function capitalizeWords(text: string): string {
  return text
    .toLowerCase()
    .replace(/(?:^|\s)\S/g, (c) => c.toUpperCase());
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export const handler = async (
  event: AppSyncResolverEvent<{ input: { s3Key: string; docType?: string } }>,
) => {
  const { s3Key, docType } = event.arguments.input;

  if (!s3Key) {
    throw new ValidationError("s3Key is required");
  }

  // ── Call Rekognition DetectText ────────────────────────────────────────────
  const result = await rekognition.send(
    new DetectTextCommand({
      Image: {
        S3Object: {
          Bucket: BUCKET_NAME,
          Name: s3Key,
        },
      },
    }),
  );

  const detections: TextDetection[] = result.TextDetections ?? [];

  // ── Extract raw text lines ─────────────────────────────────────────────────
  const lineDetections = detections.filter((d) => d.Type === "LINE" && d.DetectedText);
  const lines: string[] = lineDetections.map((d) => d.DetectedText!);

  const rawText = lines.join("\n");

  // Average confidence across detected lines (Rekognition reports 0–100)
  const avgConfidence =
    lineDetections.length > 0
      ? lineDetections.reduce((sum, d) => sum + (d.Confidence ?? 0), 0) /
        lineDetections.length /
        100
      : 0;

  // ── Visitor ID card: extract only the name, then discard the image ─────────
  if (docType === "id") {
    const { suggestedName, nameCandidates } = extractIdName(lineDetections);
    // Privacy: the ID photo is used for OCR only and must not be retained.
    try {
      await s3.send(new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: s3Key }));
    } catch {
      // Best-effort deletion; a bucket lifecycle rule on id/ is the safety net.
    }
    return {
      suggestedName,
      suggestedTowerName: null,
      suggestedUnitNumber: null,
      suggestedTrackingNumber: null,
      suggestedCarrier: null,
      nameCandidates,
      rawText: null, // don't echo raw ID text back to the client
      confidence: Math.round(avgConfidence * 100) / 100,
    };
  }

  // ── Detect carrier ─────────────────────────────────────────────────────────
  let suggestedCarrier: string | null = null;
  let suggestedTrackingNumber: string | null = null;

  for (const carrier of CARRIERS) {
    if (carrier.keywords.test(rawText)) {
      suggestedCarrier = carrier.name;

      // Try to find tracking number for this carrier
      const trackMatch = carrier.trackingPattern.exec(rawText.replace(/\s/g, ""));
      if (trackMatch) {
        suggestedTrackingNumber = trackMatch[1];
      } else {
        // Generic fallback: try without spaces on consecutive digit groups
        const genericMatch = rawText
          .replace(/\s/g, "")
          .match(/\b\d{10,22}\b/);
        if (genericMatch) {
          suggestedTrackingNumber = genericMatch[0];
        }
      }
      break;
    }
  }

  // ── Fallback: generic tracking number (if no carrier found) ───────────────
  if (!suggestedTrackingNumber) {
    const genericMatch = rawText.replace(/\s/g, "").match(/\d{12,22}/);
    if (genericMatch) {
      suggestedTrackingNumber = genericMatch[0];
    }
  }

  // ── Extract recipient name ─────────────────────────────────────────────────
  const suggestedName = extractRecipientName(lines);

  // ── Extract tower + unit/department (more reliable than the name) ──────────
  const { suggestedTowerName, suggestedUnitNumber } = extractLocation(rawText);

  return {
    suggestedName,
    suggestedTowerName,
    suggestedUnitNumber,
    suggestedTrackingNumber,
    suggestedCarrier,
    nameCandidates: [], // ID-only field
    rawText,
    confidence: Math.round(avgConfidence * 100) / 100,
  };
};

/**
 * Pulls the tower name and unit/department number out of an address line such as
 * "Torre Dublin, Depto. 1003" or "Depto 1003" or "Dpto. 4B".
 */
function extractLocation(text: string): {
  suggestedTowerName: string | null;
  suggestedUnitNumber: string | null;
} {
  let suggestedUnitNumber: string | null = null;
  let suggestedTowerName: string | null = null;

  const unitMatch =
    text.match(/\b(?:depto|dpto|depart(?:amento)?|unidad|interior|int)\.?\s*#?\s*([0-9]{1,5}[a-z]?)/i) ||
    text.match(/#\s*([0-9]{1,5}[a-z]?)\b/i);
  if (unitMatch) suggestedUnitNumber = unitMatch[1].toUpperCase();

  const towerMatch = text.match(/\btorre\s+([a-záéíóúñ0-9]+)/i);
  if (towerMatch) {
    const t = towerMatch[1];
    suggestedTowerName = t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
  }

  return { suggestedTowerName, suggestedUnitNumber };
}
