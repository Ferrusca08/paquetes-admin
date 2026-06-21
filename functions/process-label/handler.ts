/**
 * PackTrack — processLabel Lambda Handler
 *
 * Processes a package label photo using AWS Textract to extract:
 * - Recipient name (suggested)
 * - Tracking number (suggested)
 * - Carrier (detected)
 * - Raw OCR text
 * - Confidence score
 *
 * The photo must already be uploaded to the PackTrack S3 bucket
 * (via the getUploadUrl → presigned PUT flow).
 */
import {
  TextractClient,
  DetectDocumentTextCommand,
  type Block,
} from "@aws-sdk/client-textract";
import { BUCKET_NAME } from "../shared/constants.js";
import type { AppSyncResolverEvent } from "../shared/types.js";
import { ValidationError } from "../shared/errors.js";

const textract = new TextractClient({});

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

  // ── Call Textract ──────────────────────────────────────────────────────────
  const textractResult = await textract.send(
    new DetectDocumentTextCommand({
      Document: {
        S3Object: {
          Bucket: BUCKET_NAME,
          Name: s3Key,
        },
      },
    }),
  );

  const blocks: Block[] = textractResult.Blocks ?? [];

  // ── Extract raw text lines ─────────────────────────────────────────────────
  const lines: string[] = blocks
    .filter((b) => b.BlockType === "LINE" && b.Text)
    .map((b) => b.Text!);

  const rawText = lines.join("\n");

  // Average confidence across all word blocks
  const wordBlocks = blocks.filter(
    (b) => b.BlockType === "WORD" && b.Confidence !== undefined,
  );
  const avgConfidence =
    wordBlocks.length > 0
      ? wordBlocks.reduce((sum, b) => sum + (b.Confidence ?? 0), 0) /
        wordBlocks.length /
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

  return {
    suggestedName,
    suggestedTrackingNumber,
    suggestedCarrier,
    rawText,
    confidence: Math.round(avgConfidence * 100) / 100,
  };
};
