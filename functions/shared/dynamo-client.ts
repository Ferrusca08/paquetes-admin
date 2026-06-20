/**
 * PackTrack — DynamoDB DocumentClient singleton
 *
 * Reuses a single client instance across all invocations within
 * the same Lambda execution context (warm start optimization).
 */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  type TranslateConfig,
} from "@aws-sdk/lib-dynamodb";

const marshallOptions: TranslateConfig["marshallOptions"] = {
  removeUndefinedValues: true,
  convertEmptyValues: false,
  convertClassInstanceToMap: true,
};

const unmarshallOptions: TranslateConfig["unmarshallOptions"] = {
  wrapNumbers: false,
};

const ddbClient = new DynamoDBClient({});

export const docClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions,
  unmarshallOptions,
});
