import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { chatHandler } from './server/chat';
import fs from 'node:fs';
import path from 'node:path';

// Expone POST /api/chat en el servidor local; la API key se lee de .env.local y nunca se envía al navegador.
function aiChat(key: () => string | undefined): Plugin {
  return {
    name: 'axon-ai-chat',
    configureServer(s) { s.middlewares.use(chatHandler(key)); },
    configurePreviewServer(s) { s.middlewares.use(chatHandler(key)); },
  };
}

// Solo en local (npm run dev): "Guardar" también escribe src/data/model.json,
// para que al hacer commit & push esos supuestos sean los de inicio en Vercel.
function guardarModelo(): Plugin {
  return {
    name: 'axon-guardar-modelo',
    configureServer(s) {
      s.middlewares.use((req, res, next) => {
        if (req.url !== '/api/guardar-modelo' || req.method !== 'POST') return next();
        let b = ''; req.on('data', c => { b += c; });
        req.on('end', () => {
          try {
            const m = JSON.parse(b);
            if (!m || !Array.isArray(m.clients) || !m.params) throw new Error('Modelo inválido');
            fs.writeFileSync(path.resolve(process.cwd(), 'src/data/model.json'), JSON.stringify(m));
            res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}');
          } catch (e) { res.writeHead(400); res.end(String((e as Error).message)); }
        });
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), guardarModelo(), aiChat(() => env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY)],
    server: { port: 5173, open: true },
  };
});
