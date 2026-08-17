/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_ENABLE_DEMO_MODE?: string;
  readonly VITE_EMERGENCY_NUMBER?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
