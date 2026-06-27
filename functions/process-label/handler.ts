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
import { BUCKET_NAME } from "../shared/constants.js";
import type { AppSyncResolverEvent } from "../shared/types.js";
import { ValidationError } from "../shared/errors.js";

const rekognition = new RekognitionClient({});

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

function capitalizeWords(text: string): string {
  return text
    .toLowerCase()
    .replace(/(?:^|\s)\S/g, (c) => c.toUpperCase());
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export const handler = async (
  event: AppSyncResolverEvent<{ input: { s3Key: string } }>,
) => {
  const { s3Key } = event.arguments.input;

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
