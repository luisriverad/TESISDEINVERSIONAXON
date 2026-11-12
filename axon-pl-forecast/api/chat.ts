// Función de Vercel: mismo conector del Asesor IA que usa el servidor local
import type { IncomingMessage, ServerResponse } from 'node:http';
import { chatHandler } from '../server/chat.js';

const handle = chatHandler(() => process.env.ANTHROPIC_API_KEY);

export default function handler(req: IncomingMessage, res: ServerResponse) {
  return handle(req, res, () => { res.statusCode = 404; res.end(); });
}
