/**
 * Planificador de olas de migración/despliegue.
 *
 * Reparte usuarios en una ola piloto y N olas productivas respetando:
 *   1. Capacidad de soporte por ola (en unidades: estándar = 1, crítico = 2).
 *   2. La ola piloto solo lleva usuarios clave, repartidos entre áreas.
 *   3. Los usuarios críticos no entran en la primera ola productiva y tienen un
 *      tope por ola (% de la capacidad).
 *   4. Las áreas con bloqueo (p.ej. cierre contable) no se agendan en esas fechas.
 *   5. Se intenta mover cada área completa en una sola ola. Solo se divide si no cabe.
 *   6. Entre las olas válidas se elige la de más holgura, para balancear la carga.
 *
 * Funciona en el navegador (window.Olas) y en Node (require).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Olas = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const PESO = { estandar: 1, clave: 1, critico: 2 };

  const AREAS = [
    { nombre: 'Operaciones', peso: 30 },
    { nombre: 'Comercial', peso: 18 },
    { nombre: 'Finanzas', peso: 14 },
    { nombre: 'Logística', peso: 14 },
    { nombre: 'Personas', peso: 10 },
    { nombre: 'TI', peso: 8 },
    { nombre: 'Legal', peso: 6 }
  ];
  const SEDES = ['Sede Norte', 'Sede Centro', 'Sede Sur'];
  const NOMBRES = ['Ana', 'Benjamín', 'Carla', 'Diego', 'Elena', 'Felipe', 'Gabriela', 'Héctor', 'Isidora', 'Joaquín', 'Karen', 'Lucas', 'Martina', 'Nicolás', 'Olivia', 'Pablo', 'Renata', 'Sebastián', 'Trinidad', 'Vicente'];
  const APELLIDOS = ['Araya', 'Bravo', 'Castro', 'Donoso', 'Espinoza', 'Figueroa', 'Gallardo', 'Henríquez', 'Ibáñez', 'Jara', 'Lagos', 'Medina', 'Navarro', 'Orellana', 'Pizarro', 'Quiroz', 'Riquelme', 'Salinas', 'Tapia', 'Valdés'];

  /** PRNG determinista (mulberry32): misma semilla => mismos usuarios. */
  function crearAleatorio(semilla) {
    let a = semilla >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function elegirPonderado(rnd, opciones) {
    const total = opciones.reduce((s, o) => s + o.peso, 0);
    let x = rnd() * total;
    for (const o of opciones) if ((x -= o.peso) < 0) return o.nombre;
    return opciones[opciones.length - 1].nombre;
  }

  /** Genera usuarios simulados. ~8% clave, ~7% críticos, resto estándar. */
  function generarUsuarios({ cantidad = 120, semilla = 42 } = {}) {
    const rnd = crearAleatorio(semilla);
    const usuarios = [];
    for (let i = 0; i < cantidad; i++) {
      const x = rnd();
      usuarios.push({
        id: 'U' + String(i + 1).padStart(3, '0'),
        nombre: `${NOMBRES[Math.floor(rnd() * NOMBRES.length)]} ${APELLIDOS[Math.floor(rnd() * APELLIDOS.length)]}`,
        area: elegirPonderado(rnd, AREAS),
        sede: SEDES[Math.floor(rnd() * SEDES.length)],
        perfil: x < 0.08 ? 'clave' : x < 0.15 ? 'critico' : 'estandar'
      });
    }
    return usuarios;
  }

  function sumarDias(iso, dias) {
    const d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + dias);
    return d.toISOString().slice(0, 10);
  }

  /** Calendario: piloto en la fecha de inicio y luego una ola cada `diasEntreOlas`. */
  function calendario({ fechaInicio, numOlas, diasEntreOlas }) {
    const olas = [{ nombre: 'Piloto', fecha: fechaInicio, piloto: true }];
    for (let i = 1; i <= numOlas; i++) olas.push({ nombre: `Ola ${i}`, fecha: sumarDias(fechaInicio, i * diasEntreOlas), piloto: false });
    return olas;
  }

  function bloqueada(area, fecha, bloqueos) {
    return bloqueos.some((b) => b.area === area && fecha >= b.desde && fecha <= b.hasta);
  }

  /**
   * @param {Array} usuarios
   * @param {{fechaInicio, numOlas, diasEntreOlas, capacidad, maxCriticosPct, tamanoPiloto, bloqueos}} cfg
   */
  function planificar(usuarios, cfg) {
    const bloqueos = cfg.bloqueos || [];
    const maxCriticos = Math.max(1, Math.floor((cfg.capacidad * cfg.maxCriticosPct) / 100));
    const olas = calendario(cfg).map((o) => ({ ...o, usuarios: [], carga: 0, criticos: 0, capacidad: o.piloto ? cfg.tamanoPiloto : cfg.capacidad }));
    const piloto = olas[0];
    const productivas = olas.slice(1);
    const sinAsignar = [];
    const advertencias = [];

    const libre = (o) => o.capacidad - o.carga;
    const asignar = (o, u, motivo) => {
      o.usuarios.push({ ...u, motivo });
      o.carga += PESO[u.perfil];
      if (u.perfil === 'critico') o.criticos++;
    };
    /** Entre las olas que cumplen la condición, la de más holgura (empate: la más temprana). */
    const masHolgada = (lista, cond) =>
      lista.filter(cond).reduce((mejor, o) => (!mejor || libre(o) > libre(mejor) ? o : mejor), null);

    // 1. Piloto: usuarios clave en round-robin por área, para que todas las áreas validen.
    const clavesPorArea = agrupar(usuarios.filter((u) => u.perfil === 'clave'), 'area');
    const enPiloto = new Set();
    let quedan = true;
    while (quedan && libre(piloto) > 0) {
      quedan = false;
      for (const lista of clavesPorArea.values()) {
        const u = lista.find((x) => !enPiloto.has(x.id) && !bloqueada(x.area, piloto.fecha, bloqueos));
        if (!u || libre(piloto) <= 0) continue;
        asignar(piloto, u, 'Usuario clave: valida en el piloto');
        enPiloto.add(u.id);
        quedan = true;
      }
    }

    // 2. Áreas completas (sin críticos), de la más grande a la más chica.
    const resto = usuarios.filter((u) => !enPiloto.has(u.id));
    const porArea = [...agrupar(resto.filter((u) => u.perfil !== 'critico'), 'area').entries()].sort((a, b) => b[1].length - a[1].length);

    for (const [area, lista] of porArea) {
      const permitida = (o) => !bloqueada(area, o.fecha, bloqueos);
      const entera = masHolgada(productivas, (o) => permitida(o) && libre(o) >= lista.length);
      if (entera) {
        lista.forEach((u) => asignar(entera, u, 'Área completa en una sola ola'));
        continue;
      }
      // No cabe completa: se divide, llenando primero las olas con más holgura.
      const pendientes = [...lista];
      while (pendientes.length) {
        const o = masHolgada(productivas, (x) => permitida(x) && libre(x) > 0);
        if (!o) break;
        pendientes.splice(0, libre(o)).forEach((u) => asignar(o, u, 'Área dividida por capacidad'));
      }
      sinAsignar.push(...pendientes);
    }

    // 3. Críticos: desde la segunda ola productiva, junto a su área si se puede y con tope por ola.
    for (const u of resto.filter((x) => x.perfil === 'critico')) {
      const valida = (o, i) =>
        i >= 1 && !bloqueada(u.area, o.fecha, bloqueos) && libre(o) >= PESO.critico && o.criticos < maxCriticos;
      const candidatas = productivas.filter(valida);
      const conSuArea = candidatas.filter((o) => o.usuarios.some((x) => x.area === u.area));
      const o = masHolgada(conSuArea.length ? conSuArea : candidatas, () => true);
      if (o) asignar(o, u, conSuArea.length ? 'Crítico: junto a su área, tras estabilizar' : 'Crítico: ola posterior con cupo');
      else sinAsignar.push(u);
    }

    // 4. Advertencias.
    if (sinAsignar.length) advertencias.push(`${sinAsignar.length} usuario(s) sin ola: falta capacidad. Agrega olas o sube la capacidad.`);
    const clavesSinPiloto = usuarios.filter((u) => u.perfil === 'clave' && !enPiloto.has(u.id)).length;
    if (clavesSinPiloto) advertencias.push(`${clavesSinPiloto} usuario(s) clave no cupieron en el piloto y van en olas productivas.`);
    for (const area of new Set(usuarios.map((u) => u.area))) {
      const enPilotoArea = piloto.usuarios.some((u) => u.area === area);
      if (!enPilotoArea) advertencias.push(`El área ${area} no tiene usuarios clave en el piloto.`);
    }
    for (const o of olas) if (o.carga / o.capacidad > 0.9) advertencias.push(`${o.nombre} queda sobre el 90% de su capacidad de soporte.`);

    return { olas, sinAsignar, advertencias, maxCriticos, metricas: metricas(olas, usuarios, sinAsignar) };
  }

  function agrupar(lista, campo) {
    const m = new Map();
    for (const x of lista) {
      if (!m.has(x[campo])) m.set(x[campo], []);
      m.get(x[campo]).push(x);
    }
    return m;
  }

  function metricas(olas, usuarios, sinAsignar) {
    const productivas = olas.filter((o) => !o.piloto);
    const cargas = productivas.map((o) => o.carga);
    const promedio = cargas.reduce((s, c) => s + c, 0) / (cargas.length || 1);
    const desviacion = Math.sqrt(cargas.reduce((s, c) => s + (c - promedio) ** 2, 0) / (cargas.length || 1));
    // Un área está "dividida" si sus usuarios no críticos quedan en más de una ola productiva.
    const olasPorArea = new Map();
    for (const o of productivas) for (const u of o.usuarios) {
      if (u.perfil === 'critico') continue;
      if (!olasPorArea.has(u.area)) olasPorArea.set(u.area, new Set());
      olasPorArea.get(u.area).add(o.nombre);
    }
    return {
      totalUsuarios: usuarios.length,
      asignados: usuarios.length - sinAsignar.length,
      cargaPromedio: Math.round(promedio * 10) / 10,
      desviacionCarga: Math.round(desviacion * 10) / 10,
      areasDivididas: [...olasPorArea.entries()].filter(([, s]) => s.size > 1).map(([a]) => a)
    };
  }

  function aCSV(plan) {
    const filas = ['ola,fecha,id,nombre,area,sede,perfil,motivo'];
    for (const o of plan.olas) for (const u of o.usuarios) filas.push([o.nombre, o.fecha, u.id, u.nombre, u.area, u.sede, u.perfil, `"${u.motivo}"`].join(','));
    for (const u of plan.sinAsignar) filas.push(['Sin asignar', '', u.id, u.nombre, u.area, u.sede, u.perfil, '"Sin capacidad"'].join(','));
    return filas.join('\n');
  }

  return { PESO, AREAS, crearAleatorio, generarUsuarios, calendario, sumarDias, bloqueada, planificar, aCSV };
});
