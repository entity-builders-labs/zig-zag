const { execSync } = require('child_process');

// Definición de Labels (Epics y Tipos)
const labelsToCreate = [
  {
    name: 'Epic: User DNA',
    color: '0075ca',
    description: 'Gestión de usuarios y preferencias',
  },
  {
    name: 'Epic: The Brain',
    color: 'd93f0b',
    description: 'Motor de planificación y algoritmos',
  },
  {
    name: 'Epic: The Experience',
    color: '0e8a16',
    description: 'UX de viaje y guías',
  },
  {
    name: 'Epic: Logistics',
    color: '5319e7',
    description: 'Servicios y utilidades',
  },
  { name: 'backend', color: 'c5def5', description: 'Tareas de backend' },
  { name: 'frontend', color: 'c2e0c6', description: 'Tareas de frontend' },
  { name: 'auth', color: 'bfd4f2', description: 'Autenticación y seguridad' },
  { name: 'ui/ux', color: 'fef2c0', description: 'Diseño e interfaz' },
  { name: 'database', color: 'bfdadc', description: 'Base de datos' },
  { name: 'feature', color: 'a2eeef', description: 'Nueva funcionalidad' },
  { name: 'ai', color: 'd4c5f9', description: 'Inteligencia Artificial' },
  { name: 'map', color: 'c2e0c6', description: 'Mapas y geolocalización' },
  {
    name: 'integration',
    color: 'f9d0c4',
    description: 'Integraciones externas',
  },
  {
    name: 'notifications',
    color: 'e99695',
    description: 'Notificaciones y alertas',
  },
];

// Definición de Tareas
const tasks = [
  // EPIC 1: USER DNA
  {
    title: 'feat(auth): Implementar registro y perfil base de usuario',
    body: 'Como nuevo usuario, quiero registrarme y completar mis datos básicos (edad, residencia, idiomas) para tener una cuenta activa.\n\n**Criterios:**\n- Login/Register (Email/Pass).\n- Onboarding form.\n- Persistencia en DB.',
    labels: ['Epic: User DNA', 'backend', 'frontend', 'auth'],
  },
  {
    title: "feat(profile): Configuración de 'ADN Viajero' y preferencias",
    body: 'Como usuario, quiero definir mis gustos específicos (ritmo, tipo de turismo, restricciones alimentarias) para que los itinerarios se ajusten a mí.\n\n**Criterios:**\n- UI Intereses múltiples.\n- UI Ritmo de viaje.\n- UI Preferencias alimenticias.\n- Guardado en DB.',
    labels: ['Epic: User DNA', 'frontend', 'ui/ux'],
  },
  {
    title: 'chore(db): Modelado de datos de Usuario y Preferencias',
    body: 'Diseñar y migrar esquema de Prisma para Usuarios y Preferencias.\n\n**Checklist:**\n- Modelo User.\n- Modelo UserPreferences.\n- Migración DB.',
    labels: ['Epic: User DNA', 'backend', 'database'],
  },

  // EPIC 2: THE BRAIN (PLANNER)
  {
    title: "feat(planner): Wizard de creación de 'Nuevo Viaje'",
    body: 'Como usuario, quiero iniciar un nuevo viaje especificando destino, fechas, acompañantes y presupuesto total.\n\n**Inputs:**\n- Destino.\n- Fechas.\n- Presupuesto.\n- Acompañantes.',
    labels: ['Epic: The Brain', 'frontend', 'feature'],
  },
  {
    title:
      'ai(planner): Adaptar algoritmo para considerar Perfil + Presupuesto',
    body: 'El sistema debe generar un itinerario que filtre actividades impagables o irrelevantes.\n\n**Reqs:**\n- Prompt incluye JSON de perfil.\n- Prompt incluye hard constraint de presupuesto.\n- División lógica en días.',
    labels: ['Epic: The Brain', 'backend', 'ai'],
  },

  // EPIC 3: THE EXPERIENCE
  {
    title: 'feat(audio): Generación de audio guías (TTS)',
    body: 'Implementar servicio backend para convertir descripciones de actividades a audio para el usuario.\n\n**Tech:**\n- OpenAI Audio / Google TTS.\n- Caching de archivos de audio.',
    labels: ['Epic: The Experience', 'backend', 'ai'],
  },
  {
    title: 'feat(map): Visualización de ruta diaria y navegación',
    body: 'Mostrar ruta del día en mapa con polilíneas y navegación paso a paso.\n\n**UI:**\n- Mapa con pines ordenados.\n- Polilínea de recorrido.\n- Info de transporte.',
    labels: ['Epic: The Experience', 'frontend', 'map'],
  },

  // EPIC 4: LOGISTICS
  {
    title: 'feat(search): Sugerencia de Alojamiento Contextual',
    body: 'Mostrar opciones de alojamiento basadas en el presupuesto del viaje y la ubicación de las actividades.',
    labels: ['Epic: Logistics', 'backend', 'integration'],
  },
  {
    title: 'feat(notifications): Alertas de horarios de comida',
    body: 'Notificar al usuario cuando sea hora de comer y sugerir restaurantes cercanos compatibles con su dieta.',
    labels: ['Epic: Logistics', 'feature', 'notifications'],
  },
];

console.log(`🚀 Iniciando script de Roadmap...\n`);

// 1. Obtener info del repo
let repoInfo;
try {
  const json = execSync('gh repo view --json owner,name', {
    encoding: 'utf-8',
  });
  repoInfo = JSON.parse(json);
  console.log(
    `📂 Repositorio detectado: ${repoInfo.owner.login}/${repoInfo.name}`
  );
} catch (e) {
  console.error(
    '❌ Error: No se pudo detectar el repositorio. Asegúrate de estar en la carpeta raíz y logueado (gh auth login).'
  );
  process.exit(1);
}

// 2. Función para crear labels via API (Compatible con versiones viejas de gh)
function createLabel(label) {
  try {
    // Endpoint: POST /repos/{owner}/{repo}/labels
    // Usamos 'gh api' que es más estable entre versiones
    const cmd = `gh api repos/${repoInfo.owner.login}/${repoInfo.name}/labels -f name="${label.name}" -f color="${label.color}" -f description="${label.description}" --silent`;
    execSync(cmd);
    console.log(`   ✅ Label creado: ${label.name}`);
  } catch (e) {
    // Si falla, probablemente ya existe (status 422). Lo ignoramos.
    // console.log(`   (Label "${label.name}" ya existe o no se pudo crear)`);
  }
}

console.log(`📦 Asegurando existencia de etiquetas...`);
labelsToCreate.forEach((label) => createLabel(label));
console.log(`✅ Etiquetas listas.\n`);

// 3. Crear Issues
let createdCount = 0;
console.log(`📝 Creando tareas con etiquetas...`);
execSync('sleep 1');

tasks.forEach((task, index) => {
  const labelFlags = task.labels.map((l) => `--label "${l}"`).join(' ');

  try {
    console.log(
      `   [${index + 1}/${tasks.length}] Creando: "${task.title}"...`
    );
    const cmd = `gh issue create --title "${task.title}" --body "${task.body}" ${labelFlags}`;
    const output = execSync(cmd, { encoding: 'utf-8' });
    console.log(`      ✅ OK: ${output.trim()}`);
    createdCount++;
    execSync('sleep 1');
  } catch (error) {
    console.error(`      ❌ Error: ${error.message}`);
  }
});

console.log(`\n✨ Proceso finalizado. ${createdCount} tareas creadas.`);
