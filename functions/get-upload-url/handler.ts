/**
 * PackTrack — getUploadUrl Lambda Handler
 *
 * Generates a presigned S3 PUT URL so the mobile app can
 * upload photos directly to S3 without proxying through a server.
 */
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { BUCKET_NAME } from "../shared/constants.js";
import type {
  AppSyncResolverEvent,
  GetUploadUrlInput,
} from "../shared/types.js";
import { ValidationError } from "../shared/errors.js";
import { generateId } from "../shared/utils.js";

const s3 = new S3Client({});
const EXPIRATION_SECONDS = 300; // 5 minutes

const ALLOWED_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "heic"]);
const ALLOWED_PURPOSES = new Set(["label", "evidence"]);

export const handler = async (
  event: AppSyncResolverEvent<{ input: GetUploadUrlInput }>,
) => {
  const { input } = event.arguments;
  const ext = input.fileExtension.toLowerCase().replace(".", "");
  const purpose = input.purpose.toLowerCase();

  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new ValidationError(
      `Invalid file extension: ${ext}. Allowed: ${[...ALLOWED_EXTENSIONS].join(", ")}`,
    );
  }

  if (!ALLOWED_PURPOSES.has(purpose)) {
    throw new ValidationError(
      `Invalid purpose: ${purpose}. Allowed: ${[...ALLOWED_PURPOSES].join(", ")}`,
    );
  }

  // S3 key: <purpose>/<buildingId>/<uuid>.<ext>
  const key = `${purpose}/${input.buildingId}/${generateId()}.${ext}`;

  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    ContentType: `image/${ext === "jpg" ? "jpeg" : ext}`,
  });

  const uploadUrl = await getSignedUrl(s3, command, {
    expiresIn: EXPIRATION_SECONDS,
  });

  return {
    uploadUrl,
    key,
    expiresIn: EXPIRATION_SECONDS,
  };
};
