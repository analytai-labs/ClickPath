export type ImageType =
  | "og-image"
  | "qr-logo"
  | "qr-code"
  | "feedback"
  | "bio-avatar"
  | "bio-og"
  /** Any image embedded in a template page's `templateData`, for every template. */
  | "template-media";

export type WorkspaceType = "personal" | "team";

export interface UploadImageParams {
  buffer: Buffer;
  contentType: string;
  imageType: ImageType;
  workspaceId: string;
  resourceId: string;
  workspaceType: WorkspaceType;
  extension?: string;
}

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  publicUrl: string;
}
