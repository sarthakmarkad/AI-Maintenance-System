export const errorNames: Record<string, string> = {
  LOCAL_EMBEDDINGS_UNAVAILABLE:
    "The local embedding service is offline. Restart the project to start it again.",
  LOCAL_EMBEDDING_MODEL_MISSING:
    "The local embedding model is missing. Ask the administrator to run the embedding setup.",
  LOCAL_EMBEDDING_MODEL_CHANGED:
    "The installed embedding model differs from the approved profile. Contact the administrator before reindexing.",
  LOCAL_EMBEDDING_FAILED:
    "The local embedding service could not process this text. Check the service and retry indexing.",
  OCR_REQUIRED:
    "No readable text found. Upload a PDF with selectable text; OCR is not included.",
  PDF_ENCRYPTED: "The PDF is encrypted. Upload an unlocked, reviewed copy.",
  PDF_PAGE_LIMIT: "PDF exceeds the 200-page indexing limit.",
  PDF_TEXT_LIMIT: "PDF exceeds the text extraction limit.",
  PDF_CHUNK_LIMIT: "PDF exceeds the 500-passage indexing limit.",
  PDF_EXTRACTOR_UNAVAILABLE:
    "PDF text extraction is unavailable on the server.",
  AI_AUTH_FAILED: "The backend AI credentials need attention.",
  AI_RATE_LIMITED: "The AI provider rate limit was reached.",
  AI_QUOTA_EXCEEDED:
    "The AI account has no available API quota. The administrator must check billing and project limits, then retry.",
  SOURCE_NO_LONGER_APPROVED: "This revision is no longer approved.",
};
