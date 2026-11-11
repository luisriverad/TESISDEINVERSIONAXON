# AXON · P&L Forecast

Plataforma financiera construida a partir de `AXON - PL Forecast - v1.xlsx`. Cada pestaña del Excel es un módulo:

| Pestaña Excel | Módulo | Qué hace |
|---|---|---|
| `>>>>>>` (portada) | **Resumen** | KPIs, ventas vs utilidad, curva J del resultado acumulado, P&L resumido |
| `P&L` | **P&L** | Anual 5 años, Año 1 mensual (nov-25 a dic-26), Año 2 mensual, cartera de clientes editable |
| `Gastos` | **Gastos** | Gasto operativo, plantilla, marketing, supuestos de ingresos/costos y tasas |
| `Crédito Bancario` | **Crédito bancario** | Amortización a saldos insolutos, resumen anual |
| `VALUACIÓN` | **Valuación** | WACC, escenario Base/Meta, FCFF, valor terminal, EV → capital, sensibilidades |

Las celdas amarillas son supuestos editables; todo recalcula en vivo y se guarda en `localStorage` del navegador.

## Arranque

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # valida el motor contra los valores del Excel
npm run build      # genera /dist para desplegar
```

## Estructura

```
src/
  App.tsx                 UI completa (módulos, tablas, gráficas SVG, tokens de marca en `C`)
  main.tsx                punto de entrada
  lib/engine.ts           motor de cálculo puro — réplica 1:1 de las fórmulas del Excel
  lib/__tests__/          prueba de paridad contra el Excel (expected.json)
  data/model.json         supuestos por defecto
  assets/axon-logo.png
scripts/extract_from_excel.py   regenera model.json y expected.json desde un Excel nuevo
```

### Actualizar desde una nueva versión del Excel

```bash
pip install openpyxl
python3 scripts/extract_from_excel.py "AXON - PL Forecast - v2.xlsx" src/data/model.json src/lib/__tests__/expected.json
npm test
```
(El Excel debe estar guardado/recalculado para que los valores cacheados existan.)
Si cambias datos por defecto, borra la clave `axon-pl-forecast-v1` del `localStorage` o usa "Restablecer supuestos".

## Notas del modelo

- **Head of Engineering** no tiene sueldo capturado en `Gastos!C22`: su costo 2028–2030 sale en $0 con 1–2 personas de plantilla. Con $60,000/mes el valor del capital baja de $30.2M a $26.7M (no cumple meta de $30M).
- "Año 1" abarca 14 meses (nov-25 a dic-26).
- Años 3–5 se proyectan con el escenario activo (`VALUACIÓN!K5`): crecimiento de volumen y aumento de precio de desarrollo.

Powered by AXON B2B
