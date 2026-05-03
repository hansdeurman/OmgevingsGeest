/// <reference types="vite/client" />

declare const __BUILD_SHA__: string;
declare const __BUILD_TIME__: string;

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<{}, {}, any>;
  export default component;
}
