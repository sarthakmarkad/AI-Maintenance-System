// Feature-local response contract until the parent regenerates the combined OpenAPI client.
export type DocumentFile = {
  id: string;
  number: number;
  filename: string;
  description: string;
  byteSize: number;
  sha256: string;
  status: "CURRENT" | "DRAFT" | "SUPERSEDED" | "WITHDRAWN";
};
export type DocumentEvent = {
  id: string;
  fileId: string;
  revision: number;
  action: string;
  reason: string;
  actorId: string;
  actorName: string;
  actorRole: string;
  at: string;
};
export type MachineDocument = {
  id: string;
  title: string;
  kind: string;
  version: number;
  createdAt: string;
  currentFileId: string | null;
  files: DocumentFile[];
  events: DocumentEvent[];
};
export type DocumentLibrary = {
  items: MachineDocument[];
  total: number;
  page: number;
  pageSize: number;
  canManage: boolean;
  canApprove: boolean;
  maxBytes: number;
  maxDocuments: number;
  maxVersions: number;
};
