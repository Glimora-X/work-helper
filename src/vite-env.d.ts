/// <reference types="vite/client" />

interface Window {
  assistantDesktop?: {isDesktop: boolean};
}

interface ImportMetaEnv {
  readonly VITE_DEPLOY_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
