# Agendamiento por olas

Demo de cómo **repartir usuarios en olas** de una migración o despliegue (por ejemplo, el cambio de correo, de intranet o de ERP) respetando la **capacidad de soporte** del equipo, los **perfiles** de usuario y las **ventanas en que un área no puede detenerse**.

> Los usuarios se **generan al azar** con una semilla fija: nombres, áreas y sedes son ficticios.

## Qué muestra

- **Una ola piloto y N olas productivas**, con su fecha, su carga de soporte y el desglose por área.
- **KPIs del plan**: usuarios asignados, carga promedio, desviación de carga entre olas y áreas que hubo que dividir.
- **Advertencias**: usuarios sin cupo, olas sobre el 90% de capacidad y áreas sin representante en el piloto.
- Tabla de usuarios con la ola asignada y **el motivo de cada asignación**, exportable a CSV.

Cambia los parámetros (cantidad de usuarios, capacidad, número de olas, bloqueos) y el plan se recalcula.

## Reglas de distribución

1. **Capacidad en unidades de soporte.** Un usuario estándar o clave consume 1 unidad y uno crítico consume 2, porque requiere acompañamiento.
2. **El piloto solo lleva usuarios clave**, tomados por turnos de cada área para que todas validen antes del despliegue masivo.
3. **Los usuarios críticos no van en la primera ola productiva.** Esperan a que el proceso esté estabilizado y tienen un **tope por ola** (% de la capacidad).
4. **Bloqueos por área.** Un área en ventana de bloqueo (por ejemplo, Finanzas en cierre contable) no se agenda en esas fechas.
5. **Cohesión de área.** Cada área se mueve completa en una sola ola y solo se divide si no cabe en ninguna.
6. **Balance de carga.** Entre las olas válidas se elige la de **más holgura**, no la primera disponible. Así se evita una primera ola saturada y una última vacía.

Los críticos se agendan después de las áreas y, si se puede, en la misma ola que el resto de su área.

## Decisiones de diseño

| Decisión | Por qué |
|---|---|
| **Heurística greedy en lugar de un optimizador** | Con decenas o cientos de usuarios, una regla del tipo "la ola más holgada que cumpla todo" da planes buenos, rápidos y, sobre todo, **explicables**: cada usuario lleva el motivo de su asignación. |
| **Áreas de mayor a menor** | Como en el *bin packing* "first-fit decreasing": ubicar primero los bloques grandes deja los huecos para los chicos y reduce las divisiones. |
| **Peso por perfil** | La restricción real no es "cantidad de personas", sino "cuánta atención puede dar la mesa de ayuda ese día". |
| **Semilla fija** | Los mismos parámetros siempre producen el mismo plan, lo que facilita comparar escenarios y testear. |
| **Lógica pura y testeada** | `src/olas.js` no toca el DOM. Los tests verifican las invariantes: nadie queda dos veces, no se excede la capacidad, se respetan los bloqueos y los topes de críticos. |

## Cómo usarlo

Abre `index.html` en el navegador (o la versión de GitHub Pages). No requiere instalación.

```bash
npm test   # Node 18+, sin dependencias
```

## Estructura

```
index.html        interfaz
src/olas.js       generador de usuarios + planificador (puro)
tests/            tests de invariantes con node:test
```

## Licencia

MIT
