import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { chatHandler } from './server/chat';

// Expone POST /api/chat en el servidor local; la API key se lee de .env.local y nunca se envía al navegador.
function aiChat(key: () => string | undefined): Plugin {
  return {
    name: 'axon-ai-chat',
    configureServer(s) { s.middlewares.use(chatHandler(key)); },
    configurePreviewServer(s) { s.middlewares.use(chatHandler(key)); },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), aiChat(() => env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY)],
    server: { port: 5173, open: true },
  };
});
