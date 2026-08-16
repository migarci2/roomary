const X_LIMIT = 4.3;
const Z_LIMIT = 3.3;
const WALL_Z_LIMIT = 3.95;

export const CATALOG = Object.freeze([
  { type: 'bed', label: 'Bed', terms: ['bed', 'cama'], color: '#a96249', position: [-2.4, -1.8], footprint: [2.1, 3.05] },
  { type: 'desk', label: 'Desk', terms: ['desk', 'escritorio'], color: '#8b633f', position: [2.6, -2.5], footprint: [2.2, 1] },
  { type: 'chair', label: 'Chair', terms: ['chair', 'silla'], color: '#bd8c57', position: [2.6, -0.9], footprint: [1, 1] },
  { type: 'window', label: 'Window', terms: ['window', 'ventana'], color: '#8fb6bd', position: [-2.2, -3.9], footprint: [2.3, .12], wall: true },
  { type: 'door', label: 'Door', terms: ['door', 'puerta'], color: '#71513a', position: [3.4, 3.9], footprint: [1.4, .18], wall: true },
  { type: 'lamp', label: 'Lamp', terms: ['lamp', 'lampara', 'lámpara'], color: '#c79a45', position: [2.2, -2.3], footprint: [.84, .84], overlay: true },
  { type: 'rug', label: 'Rug', terms: ['rug', 'carpet', 'alfombra'], color: '#9c4c3f', position: [0, .2], footprint: [3.3, 2.2], overlay: true },
  { type: 'wardrobe', label: 'Wardrobe', terms: ['wardrobe', 'closet', 'armario'], color: '#775238', position: [-4.1, 1.8], footprint: [1.15, 2.15] },
  { type: 'bookshelf', label: 'Bookshelf', terms: ['bookshelf', 'bookcase', 'estanteria', 'estantería'], color: '#815f3f', position: [-4.25, -1.4], footprint: [1.15, 2.2] },
  { type: 'sofa', label: 'Sofa', terms: ['sofa', 'sofá', 'couch'], color: '#6f7b68', position: [-1.8, 1.7], footprint: [2.7, 1.15] },
  { type: 'table', label: 'Table', terms: ['table', 'mesa'], color: '#9a7046', position: [.8, .8], footprint: [1.8, 1.4] },
  { type: 'plant', label: 'Plant', terms: ['plant', 'planta'], color: '#55765a', position: [3.8, -2.7], footprint: [.8, .8] }
].map((item) => Object.freeze({
  ...item,
  terms: Object.freeze(item.terms),
  position: Object.freeze(item.position),
  footprint: Object.freeze(item.footprint)
})));

const COLOURS = Object.freeze({
  red: '#9c4c3f', rojo: '#9c4c3f', roja: '#9c4c3f',
  blue: '#537897', azul: '#537897',
  green: '#55765a', verde: '#55765a',
  yellow: '#d0a545', amarillo: '#d0a545', amarilla: '#d0a545',
  orange: '#cf7648', naranja: '#cf7648',
  purple: '#785f8e', morado: '#785f8e', morada: '#785f8e',
  pink: '#c77d86', rosa: '#c77d86',
  brown: '#775238', marron: '#775238', marrón: '#775238',
  grey: '#77736c', gray: '#77736c', gris: '#77736c',
  black: '#34312d', negro: '#34312d', negra: '#34312d',
  white: '#e9e2d6', blanco: '#e9e2d6', blanca: '#e9e2d6',
  oak: '#9a7046', roble: '#9a7046',
  brass: '#c79a45', laton: '#c79a45', latón: '#c79a45'
});

const RELATIONS = Object.freeze({
  beneath: ['beneath', 'under', 'below', 'bajo', 'debajo de'],
  beside: ['beside', 'next to', 'junto', 'junto a', 'al lado', 'al lado de'],
  facing: ['facing', 'opposite', 'in front of', 'frente', 'frente a', 'enfrente de']
});

const normalize = (value) => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const clamp = (value, limit) => Math.max(-limit, Math.min(limit, value));
const itemFor = (type) => CATALOG.find((item) => item.type === type);
const termPattern = (item) => `(?:${item.terms.map((term) => escapeRegExp(normalize(term))).join('|')})s?`;

function mentions(text, item) {
  return new RegExp(`\\b${termPattern(item)}\\b`, 'i').test(text);
}

function isRemoved(text, item) {
  const term = termPattern(item);
  return [
    `\\b(?:remove|delete|without|no|sin|quita|quitar|retira|retirar|elimina|eliminar)(?:\\s+\\w+){0,4}\\s+${term}\\b`,
    `\\b${term}\\b(?:\\s+\\w+){0,4}\\s+(?:(?:is|are|esta|estan)\\s+)?(?:missing|gone|falta|faltan)\\b`
  ].some((pattern) => new RegExp(pattern, 'i').test(text));
}

function specifiedColour(text, item) {
  const colours = Object.keys(COLOURS).map(escapeRegExp).join('|');
  const term = termPattern(item);
  const before = new RegExp(`\\b(${colours})\\b(?:\\s+(?:colou?red|faded|dark|light|oscuro|oscura|claro|clara)){0,2}\\s+${term}\\b`, 'i').exec(text);
  if (before) return COLOURS[before[1]];

  const joiners = 'is|are|should|must|to|be|become|make|turn|paint|painted|in|a|the|de|es|sea|en|color|colour|ponlo|ponla|hazlo|hazla|cambia';
  const after = new RegExp(`\\b${term}\\b(?:\\s+(?:${joiners})){0,7}\\s+(${colours})\\b`, 'i').exec(text);
  return after ? COLOURS[after[1]] : null;
}

function extractRelations(text, objects) {
  const available = new Set(objects.map((object) => object.type));
  const mentions = [];
  const found = [];
  const seen = new Set();

  for (const item of CATALOG) {
    if (!available.has(item.type)) continue;
    const pattern = new RegExp(`\\b${termPattern(item)}\\b`, 'gi');
    for (const match of text.matchAll(pattern)) mentions.push({ type: item.type, start: match.index, end: match.index + match[0].length });
  }

  for (const [type, aliases] of Object.entries(RELATIONS)) {
    const aliasPattern = aliases.map((value) => escapeRegExp(normalize(value))).sort((a, b) => b.length - a.length).join('|');
    const pattern = new RegExp(`\\b(?:${aliasPattern})\\b`, 'gi');
    for (const match of text.matchAll(pattern)) {
      const start = match.index;
      const end = start + match[0].length;
      const subject = mentions.filter((mention) => mention.end <= start && start - mention.end <= 42 && !/[.,;!?]/.test(text.slice(mention.end, start))).sort((a, b) => b.end - a.end)[0];
      const target = mentions.filter((mention) => mention.start >= end && mention.start - end <= 24 && !/[.,;!?]/.test(text.slice(end, mention.start))).sort((a, b) => a.start - b.start)[0];
      if (!subject || !target || subject.type === target.type) continue;
      const key = `${subject.type}:${type}:${target.type}`;
      if (!seen.has(key)) {
        seen.add(key);
        found.push({ type, subjectType: subject.type, targetType: target.type });
      }
    }
  }
  return found;
}

function uniqueId(type, objects, idFactory) {
  const used = new Set(objects.map((object) => object.id));
  if (typeof idFactory === 'function') {
    const candidate = idFactory(type, used.size);
    if (typeof candidate === 'string' && candidate && !used.has(candidate)) return candidate;
  }
  let index = 1;
  while (used.has(`${type}-${index}`)) index += 1;
  return `${type}-${index}`;
}

function materializeRelation(relation, objects) {
  const subject = typeof relation.subject === 'string'
    ? objects.find((object) => object.id === relation.subject)
    : objects.find((object) => object.type === relation.subjectType);
  const target = typeof relation.target === 'string'
    ? objects.find((object) => object.id === relation.target)
    : objects.find((object) => object.type === relation.targetType);
  if (!subject || !target || subject === target || !Object.hasOwn(RELATIONS, relation.type)) return null;
  return { type: relation.type, subject: subject.id, target: target.id, subjectType: subject.type, targetType: target.type };
}

const relationKey = (relation) => `${relation.subject}:${relation.target}`;

function applyRelations(objects, relations) {
  const applyPosition = (relation) => {
    const subject = objects.find((object) => object.id === relation.subject);
    const target = objects.find((object) => object.id === relation.target);
    if (!subject || !target) return;

    if (relation.type === 'beneath') {
      subject.x = clamp(target.x, X_LIMIT);
      const offset = itemFor(target.type).wall ? 1.55 : .95;
      subject.z = clamp(target.z + (target.z < 0 ? offset : target.z > 0 ? -offset : 1.2), Z_LIMIT);
    } else if (relation.type === 'beside') {
      const subjectWidth = itemFor(subject.type).footprint[0];
      const targetWidth = itemFor(target.type).footprint[0];
      const gap = (subjectWidth + targetWidth) / 2 + .3;
      subject.z = clamp(target.z, Z_LIMIT);
      const candidates = [target.x + gap, target.x - gap].filter((x) => Math.abs(x) <= X_LIMIT);
      subject.x = candidates[0] ?? clamp(target.x + gap, X_LIMIT);
      for (const x of candidates) {
        subject.x = x;
        if (!objects.some((other) => other !== subject && overlaps(subject, other))) break;
      }
    }
  };

  // Position dependencies settle first; facing is derived from the final coordinates.
  for (let pass = 0; pass < objects.length; pass += 1) {
    for (const relation of relations) if (relation.type !== 'facing') applyPosition(relation);
  }
  for (const relation of relations) {
    if (relation.type !== 'facing') continue;
    const subject = objects.find((object) => object.id === relation.subject);
    const target = objects.find((object) => object.id === relation.target);
    if (subject && target) subject.rotation = Math.round(Math.atan2(target.x - subject.x, target.z - subject.z) * 180 / Math.PI);
  }
}

function relationSatisfied(objects, relation) {
  const subject = objects.find((object) => object.id === relation.subject);
  const target = objects.find((object) => object.id === relation.target);
  if (!subject || !target) return false;
  if (relation.type === 'facing') return subject.rotation === Math.round(Math.atan2(target.x - subject.x, target.z - subject.z) * 180 / Math.PI);
  if (relation.type === 'beneath') {
    const offset = itemFor(target.type).wall ? 1.55 : .95;
    const expectedZ = clamp(target.z + (target.z < 0 ? offset : target.z > 0 ? -offset : 1.2), Z_LIMIT);
    return Math.abs(subject.x - clamp(target.x, X_LIMIT)) < 1e-9 && Math.abs(subject.z - expectedZ) < 1e-9;
  }
  const gap = (itemFor(subject.type).footprint[0] + itemFor(target.type).footprint[0]) / 2 + .3;
  return Math.abs(Math.abs(subject.x - target.x) - gap) < 1e-9 && Math.abs(subject.z - clamp(target.z, Z_LIMIT)) < 1e-9;
}

function dimensions(object) {
  const [width, depth] = itemFor(object.type).footprint;
  const radians = (object.rotation || 0) * Math.PI / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  return [width * cos + depth * sin, width * sin + depth * cos];
}

function blocksFloor(object) {
  const item = itemFor(object.type);
  return !item.wall && !item.overlay;
}

function overlaps(a, b) {
  if (!blocksFloor(a) || !blocksFloor(b)) return false;
  const [aw, ad] = dimensions(a);
  const [bw, bd] = dimensions(b);
  return Math.abs(a.x - b.x) * 2 < aw + bw + .16 && Math.abs(a.z - b.z) * 2 < ad + bd + .16;
}

function overlappingPairs(objects) {
  const pairs = [];
  for (let index = 0; index < objects.length; index += 1) {
    for (let other = index + 1; other < objects.length; other += 1) {
      if (overlaps(objects[index], objects[other])) pairs.push([objects[index], objects[other]]);
    }
  }
  return pairs;
}

// ponytail: deterministic grid search is O(n²); replace with spatial indexing only if catalogs grow beyond room-sized scenes.
function resolveOverlaps(objects, movableTypes) {
  const warnings = [];
  const directions = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];

  for (const object of objects) {
    if (!movableTypes.has(object.type) || !blocksFloor(object)) continue;
    if (!objects.some((other) => other !== object && overlaps(object, other))) continue;

    const origin = [object.x, object.z];
    let resolved = false;
    for (let ring = 1; ring <= 14 && !resolved; ring += 1) {
      for (const [dx, dz] of directions) {
        object.x = clamp(origin[0] + dx * ring * .45, X_LIMIT);
        object.z = clamp(origin[1] + dz * ring * .45, Z_LIMIT);
        if (!objects.some((other) => other !== object && overlaps(object, other))) {
          resolved = true;
          break;
        }
      }
    }
    if (!resolved) {
      object.x = origin[0];
      object.z = origin[1];
      warnings.push(`Could not resolve overlap for ${object.type}.`);
    }
  }
  return warnings;
}

export function validateObjects(objects) {
  const errors = [];
  if (!Array.isArray(objects)) return { valid: false, errors: ['Objects must be an array.'] };

  const ids = new Set();
  const types = new Set(CATALOG.map((item) => item.type));
  objects.forEach((object, index) => {
    const at = `Object ${index}`;
    if (!object || typeof object !== 'object' || Array.isArray(object)) {
      errors.push(`${at} must be an object.`);
      return;
    }
    if (!types.has(object.type)) errors.push(`${at} has unknown type "${object.type}".`);
    if (typeof object.id !== 'string' || !object.id) errors.push(`${at} needs a non-empty id.`);
    else if (ids.has(object.id)) errors.push(`${at} duplicates id "${object.id}".`);
    else ids.add(object.id);
    if (typeof object.label !== 'string' || !object.label.trim()) errors.push(`${at} needs a non-empty label.`);
    for (const property of ['x', 'z', 'rotation']) {
      if (typeof object[property] !== 'number' || !Number.isFinite(object[property])) errors.push(`${at}.${property} must be finite.`);
    }
    if (typeof object.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(object.color)) errors.push(`${at}.color must be a six-digit hex value.`);
    if (typeof object.x === 'number' && (object.x < -X_LIMIT || object.x > X_LIMIT)) errors.push(`${at}.x is outside room bounds.`);
    const zLimit = itemFor(object.type)?.wall ? WALL_Z_LIMIT : Z_LIMIT;
    if (typeof object.z === 'number' && (object.z < -zLimit || object.z > zLimit)) errors.push(`${at}.z is outside room bounds.`);
  });
  return { valid: errors.length === 0, errors };
}

export function sceneHash(objects) {
  if (!Array.isArray(objects)) throw new TypeError('Objects must be an array.');
  const canonical = objects.map((object) => ({
    type: object.type,
    color: object.color,
    x: Number(object.x.toFixed(4)),
    z: Number(object.z.toFixed(4)),
    rotation: Number(object.rotation.toFixed(4))
  })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  let hash = 2166136261;
  for (const character of JSON.stringify(canonical)) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function compileScene(description, current = [], patch = false, options = {}) {
  if (typeof description !== 'string') throw new TypeError('Description must be a string.');
  if (!Array.isArray(current)) throw new TypeError('Current objects must be an array.');
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('Options must be an object.');
  if (options.relations !== undefined && !Array.isArray(options.relations)) throw new TypeError('Options.relations must be an array.');

  const text = normalize(description);
  let objects = patch ? current.map((object) => ({ ...object })) : [];
  const operations = [];
  const movableTypes = new Set();

  for (const item of CATALOG) {
    if (isRemoved(text, item)) {
      const removed = objects.filter((object) => object.type === item.type);
      if (removed.length) operations.push({ kind: 'remove', type: item.type, count: removed.length });
      objects = objects.filter((object) => object.type !== item.type);
      continue;
    }
    if (!mentions(text, item)) continue;

    const colour = specifiedColour(text, item);
    const existing = objects.filter((object) => object.type === item.type);
    if (existing.length) {
      if (colour) {
        for (const object of existing) object.color = colour;
        operations.push({ kind: 'recolor', type: item.type, color: colour });
      }
      continue;
    }

    objects.push({
      id: uniqueId(item.type, objects, options.idFactory),
      type: item.type,
      label: item.label,
      color: colour || item.color,
      x: item.position[0],
      z: item.position[1],
      rotation: 0
    });
    movableTypes.add(item.type);
    operations.push({ kind: 'add', type: item.type });
  }

  for (const object of objects) {
    object.x = clamp(object.x, X_LIMIT);
    object.z = clamp(object.z, itemFor(object.type).wall ? WALL_Z_LIMIT : Z_LIMIT);
    if (!Number.isFinite(object.rotation)) object.rotation = 0;
  }

  const previousRelations = [];
  if (patch) {
    for (const relation of options.relations || []) {
      if (!relation || typeof relation !== 'object') throw new TypeError('Each previous relation must be an object.');
      if (!Object.hasOwn(RELATIONS, relation.type)) throw new TypeError(`Unsupported relation type "${relation.type}".`);
      if ((typeof relation.subject !== 'string' || !relation.subject) && (typeof relation.subjectType !== 'string' || !relation.subjectType)) throw new TypeError('Each previous relation needs a subject endpoint.');
      if ((typeof relation.target !== 'string' || !relation.target) && (typeof relation.targetType !== 'string' || !relation.targetType)) throw new TypeError('Each previous relation needs a target endpoint.');
      const materialized = materializeRelation(relation, objects);
      if (materialized) {
        previousRelations.push(materialized);
        movableTypes.add(materialized.subjectType);
      }
      else operations.push({ kind: 'unrelate', type: relation.type, subject: relation.subject, target: relation.target, reason: 'endpoint-removed' });
    }
  }

  const mergedRelations = new Map(previousRelations.map((relation) => [relationKey(relation), relation]));
  const extracted = extractRelations(text, objects).map((relation) => materializeRelation(relation, objects)).filter(Boolean);
  for (const relation of extracted) {
    const key = relationKey(relation);
    const previous = mergedRelations.get(key);
    mergedRelations.set(key, relation);
    movableTypes.add(relation.subjectType);
    if (!previous || previous.type !== relation.type) operations.push({ kind: 'relate', ...relation, ...(previous && { replaces: previous.type }) });
  }
  let relations = [...mergedRelations.values()];
  applyRelations(objects, relations);
  for (const object of objects) {
    object.x = clamp(object.x, X_LIMIT);
    object.z = clamp(object.z, itemFor(object.type).wall ? WALL_Z_LIMIT : Z_LIMIT);
  }

  const warnings = resolveOverlaps(objects, patch ? movableTypes : new Set(objects.map((object) => object.type)));
  applyRelations(objects, relations);
  const unsatisfied = relations.filter((relation) => !relationSatisfied(objects, relation));
  relations = relations.filter((relation) => relationSatisfied(objects, relation));
  for (const relation of unsatisfied) {
    warnings.push(`Dropped unsatisfied ${relation.type} relation from ${relation.subjectType} to ${relation.targetType}.`);
    operations.push({ kind: 'unrelate', ...relation, reason: 'unsatisfied-constraint' });
  }
  for (const [first, second] of overlappingPairs(objects)) warnings.push(`Could not resolve overlap between ${first.type} and ${second.type}.`);
  const validation = validateObjects(objects);
  warnings.push(...validation.errors);
  if (!objects.length) warnings.push('No catalog objects detected.');

  const entities = objects.map((object) => ({
    id: object.id,
    type: object.type,
    label: object.label,
    color: object.color,
    position: { x: object.x, z: object.z },
    rotation: object.rotation
  }));
  const hash = validation.valid ? sceneHash(objects) : null;

  return {
    objects,
    graph: { entities, relations },
    diagnostics: {
      entities: entities.length,
      relations: relations.length,
      operations,
      warnings,
      hash,
      schemaVersion: 'roomary.scene.v1',
      valid: validation.valid
    }
  };
}
