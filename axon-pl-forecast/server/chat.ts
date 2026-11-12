// Conector del Asesor IA: corre en el servidor de Vite (dev y preview) para que la API key nunca llegue al navegador.
import Anthropic from '@anthropic-ai/sdk';
import type { IncomingMessage, ServerResponse } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

// Carpeta con los PDFs de referencia que la IA lee en cada pregunta
export const DOCS_DIR = path.resolve(process.cwd(), 'docs-ia');
type Doc = { name: string; data: string };
let docsCache: { key: string; docs: Doc[] } = { key: '', docs: [] };
function loadDocs(): Doc[] {
  if (!fs.existsSync(DOCS_DIR)) return [];
  const files = fs.readdirSync(DOCS_DIR).filter(f => f.toLowerCase().endsWith('.pdf')).sort();
  const key = files.map(f => `${f}:${fs.statSync(path.join(DOCS_DIR, f)).mtimeMs}`).join('|');
  if (key !== docsCache.key) docsCache = { key, docs: files.map(f => ({ name: f.replace(/\.pdf$/i, ''), data: fs.readFileSync(path.join(DOCS_DIR, f)).toString('base64') })) };
  return docsCache.docs;
}

const MODEL = 'claude-opus-5-5';

const SYSTEM = `Eres Axon Intelligence, el asesor financiero y estratégico de AXON (Advanced AI Applied to Enterprise), una empresa mexicana que desarrolla e implementa soluciones de inteligencia artificial para empresas (B2B). Respondes dentro de la herramienta "P&L Forecast 2026–2030", que usan los fundadores e inversionistas para decidir.

Tu trabajo:
- Responder con rigor sobre el modelo financiero: P&L, supuestos, gastos, crédito, flujo libre, WACC, valuación por DFC y sensibilidades.
- Analizar el mercado objetivo (empresas con ventas mayores a US$5M en EUA hispano y Latinoamérica) y las perspectivas del negocio de IA empresarial.
- Ayudar a decidir: cuando te pidan una recomendación, da una postura clara, explica el porqué con cifras del modelo y señala los riesgos y qué supuesto la cambiaría.

Cómo responder:
- En español, tono de consultor senior: directo, claro, sin relleno. Empieza con la respuesta y después el sustento.
- Usa las cifras exactas del contexto del modelo. Montos en MXN salvo que se indique otra moneda; abrevia con $M (millones) y $k (miles).
- Si haces cálculos propios (por ejemplo, qué crecimiento haría falta para una meta), muestra el razonamiento en pocos pasos y di que es una estimación tuya, no una cifra del modelo.
- Distingue siempre entre lo que dice el modelo, lo que viene de fuentes externas y tu opinión.
- Puedes buscar en la web para datos de mercado, competencia, tendencias o tasas actuales; cita la fuente brevemente.
- Usa listas cortas o tablas sencillas en Markdown cuando ayuden; evita respuestas larguísimas salvo que te pidan detalle.
- Si algo no está en el modelo ni lo puedes verificar, dilo; no inventes cifras.
- Al inicio de la conversación recibes documentos de referencia de AXON (PDF). Úsalos como fuente principal para la tesis de inversión, el producto, la estrategia y el mercado; cuando los uses, menciona de qué documento sale la información. Si un documento contradice las cifras vivas del modelo, señálalo y da prioridad al modelo para los números.`;

// Si existe docs-ia/PROMPT.md, sus instrucciones reemplazan a las de arriba (se lee en cada pregunta)
function systemPrompt(): string {
  const f = path.join(DOCS_DIR, 'PROMPT.md');
  const t = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim() : '';
  return t || SYSTEM;
}

type Msg = { role: 'user' | 'assistant'; content: string };

function readBody(req: IncomingMessage): Promise<string> {
  // En Vercel el cuerpo puede llegar ya leído en req.body
  const pre = (req as IncomingMessage & { body?: unknown }).body;
  if (pre !== undefined) return Promise.resolve(typeof pre === 'string' ? pre : Buffer.isBuffer(pre) ? pre.toString('utf8') : JSON.stringify(pre));
  return new Promise((ok, fail) => { let b = ''; req.on('data', c => { b += c; }); req.on('end', () => ok(b)); req.on('error', fail); });
}

export function chatHandler(getKey: () => string | undefined) {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (req.url === '/api/docs' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(loadDocs().map(d => d.name)));
    }
    if (req.url !== '/api/chat' || req.method !== 'POST') return next();
    const send = (o: object) => res.write(JSON.stringify(o) + '\n');
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache' });

    const apiKey = getKey();
    if (!apiKey) { send({ t: 'error', v: 'Falta la API key. Agrega ANTHROPIC_API_KEY en el archivo .env.local y reinicia el servidor.' }); return res.end(); }

    try {
      const { messages, context } = JSON.parse(await readBody(req)) as { messages: Msg[]; context: string };
      const client = new Anthropic({ apiKey });
      // Primer turno: documentos (estables, en caché) y después las cifras vivas del modelo
      const docs = loadDocs();
      const intro: Anthropic.Beta.BetaContentBlockParam[] = docs.map((d, i) => ({
        type: 'document' as const, title: d.name,
        source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: d.data },
        ...(i === docs.length - 1 ? { cache_control: { type: 'ephemeral' as const } } : {}),
      }));
      intro.push({ type: 'text', text: `${docs.length ? `Arriba están los documentos de referencia de AXON: ${docs.map(d => `"${d.name}"`).join(', ')}.\n\n` : ''}Fecha de hoy: ${new Date().toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' })}.\n\nContexto actual del modelo financiero interactivo (cifras vivas de la herramienta, en JSON):\n${context}` });
      const convo: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: intro }, ...messages.slice(-30).map(m => ({ role: m.role, content: m.content }))];

      // El modelo puede pausar el turno tras usar la búsqueda web; se reanuda hasta 4 veces.
      for (let round = 0; round < 4; round++) {
        const stream = client.beta.messages.stream({
          model: MODEL,
          max_tokens: 64000,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          output_config: { effort: 'high' },
          system: [{ type: 'text', text: systemPrompt() }],
          cache_control: { type: 'ephemeral' },
          tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 5 }],
          messages: convo,
        });
        for await (const ev of stream) {
          if (ev.type === 'content_block_start' && ev.content_block.type === 'server_tool_use') send({ t: 'status', v: 'Buscando en la web…' });
          else if (ev.type === 'content_block_start' && ev.content_block.type === 'text') send({ t: 'status', v: '' });
          else if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') send({ t: 'text', v: ev.delta.text });
        }
        const final = await stream.finalMessage();
        if (final.stop_reason === 'refusal') { send({ t: 'error', v: 'La IA no pudo responder esta pregunta. Intenta formularla de otra manera.' }); break; }
        if (final.stop_reason !== 'pause_turn') break;
        convo.push({ role: 'assistant', content: final.content });
      }
      send({ t: 'done' });
    } catch (e) {
      const msg = e instanceof Anthropic.AuthenticationError ? 'La API key no es válida. Revisa el valor en .env.local.'
        : e instanceof Anthropic.RateLimitError ? 'Se alcanzó el límite de uso de la API. Intenta en unos minutos.'
        : e instanceof Anthropic.APIError ? `Error de la API (${e.status}): ${e.message}`
        : `No se pudo conectar con la IA: ${(e as Error).message}`;
      send({ t: 'error', v: msg });
    }
    res.end();
  };
}
