import crypto from "crypto";

/**
 * If you need a unique-ish string for logging correlation
 */
export function getRequestId(): string {
  const randomString = `${Math.round(Date.now() / 1000)}||${Math.random()}`;
  return crypto.createHash("sha256").update(randomString).digest("hex");
}

export type AwsCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
};

export function getAwsCredentials(): AwsCredentials {
  return {
    accessKeyId: process.env["AWS_ACCESS_KEY_ID"] || "",
    secretAccessKey: process.env["AWS_SECRET_ACCESS_KEY"] || "",
    region: process.env["AWS_REGION"] || "",
  };
}
