/** Build-time settings from `.env` (see `.env.example`). */
interface ImportMetaEnv {
  /** Match patterns of the pages that take part in mirroring. */
  readonly VITE_TARGET_MATCHES?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
