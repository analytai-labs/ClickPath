export type ImageType =
  | "og-image"
  | "qr-logo"
  | "qr-code"
  | "feedback"
  | "bio-avatar"
  | "bio-og"
  /** Any image embedded in a template page's `templateData`, for every template. */
  | "template-media"
  /** An image in the workspace's asset library, reusable across resources. */
  | "asset";

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

/** Where an upload landed, plus what it was — enough to record and undo it. */
export interface UploadedImage {
  url: string;
  /** R2 object key, so the object stays deletable independently of the URL. */
  key: string;
  contentType: string;
  byteSize: number;
  /** sha256 of the stored bytes, for de-duplicating repeat uploads. */
  checksum: string;
}

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  publicUrl: string;
}
