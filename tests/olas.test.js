const test = require('node:test');
const assert = require('node:assert/strict');
const O = require('../src/olas.js');

const CFG = {
  fechaInicio: '2026-11-02',
  numOlas: 4,
  diasEntreOlas: 7,
  capacidad: 36,
  maxCriticosPct: 15,
  tamanoPiloto: 10,
  bloqueos: [{ area: 'Finanzas', desde: '2026-11-07', hasta: '2026-11-22', motivo: 'Cierre contable' }]
};
const usuarios = O.generarUsuarios({ cantidad: 120, semilla: 42 });
const plan = O.planificar(usuarios, CFG);
const productivas = plan.olas.filter((o) => !o.piloto);

test('la generación es determinista por semilla', () => {
  assert.deepEqual(O.generarUsuarios({ cantidad: 20, semilla: 7 }), O.generarUsuarios({ cantidad: 20, semilla: 7 }));
  assert.notDeepEqual(O.generarUsuarios({ cantidad: 20, semilla: 7 }), O.generarUsuarios({ cantidad: 20, semilla: 8 }));
});

test('calendario: piloto + N olas espaciadas', () => {
  assert.deepEqual(O.calendario(CFG).map((o) => o.fecha), ['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30']);
});

test('todos los usuarios quedan asignados exactamente una vez', () => {
  const ids = plan.olas.flatMap((o) => o.usuarios.map((u) => u.id));
  assert.equal(plan.sinAsignar.length, 0);
  assert.equal(new Set(ids).size, usuarios.length);
  assert.equal(ids.length, usuarios.length);
});

test('ninguna ola supera su capacidad de soporte', () => {
  for (const o of plan.olas) {
    const carga = o.usuarios.reduce((s, u) => s + O.PESO[u.perfil], 0);
    assert.equal(carga, o.carga);
    assert.ok(carga <= o.capacidad, `${o.nombre}: ${carga}/${o.capacidad}`);
  }
});

test('el piloto solo lleva usuarios clave', () => {
  assert.ok(plan.olas[0].usuarios.length > 0);
  assert.ok(plan.olas[0].usuarios.every((u) => u.perfil === 'clave'));
});

test('los críticos no van en la primera ola productiva y respetan el tope', () => {
  assert.equal(productivas[0].criticos, 0);
  for (const o of productivas) assert.ok(o.criticos <= plan.maxCriticos);
});

test('las áreas bloqueadas no se agendan en sus fechas', () => {
  for (const o of plan.olas) for (const u of o.usuarios) assert.ok(!O.bloqueada(u.area, o.fecha, CFG.bloqueos), `${u.area} en ${o.fecha}`);
});

test('con holgura, ninguna área se divide y la carga queda balanceada', () => {
  assert.deepEqual(plan.metricas.areasDivididas, []);
  assert.ok(plan.metricas.desviacionCarga < 5);
});

test('si falta capacidad, se divide el área y se reporta lo que no cupo', () => {
  const ajustado = O.planificar(usuarios, { ...CFG, numOlas: 3, capacidad: 30, bloqueos: [] });
  assert.ok(ajustado.metricas.areasDivididas.length > 0);
  assert.ok(ajustado.sinAsignar.length > 0);
  assert.match(ajustado.advertencias[0], /sin ola/);
});

test('CSV tiene una fila por usuario más el encabezado', () => {
  assert.equal(O.aCSV(plan).split('\n').length, usuarios.length + 1);
});
