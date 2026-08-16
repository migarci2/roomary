import test from 'node:test';
import assert from 'node:assert/strict';
import { compileScene, sceneHash, validateObjects } from '../scene-core.mjs';

test('scene compiler builds, patches and validates deterministic EN/ES scenes', () => {
  const demo = 'A small bedroom with a bed beneath the north window, an oak desk facing the door, a brass lamp, a chair and a faded red rug.';
  const first = compileScene(demo);
  const again = compileScene(demo);

  assert.deepEqual(first, again);
  assert.equal(first.diagnostics.valid, true);
  assert.equal(first.objects.length, 7);
  assert.equal(first.diagnostics.relations, 2);
  assert.equal(sceneHash(first.objects), first.diagnostics.hash);
  assert.deepEqual(validateObjects(first.objects), { valid: true, errors: [] });
  assert.equal(first.objects.find((object) => object.type === 'desk').color, '#9a7046');
  assert.equal(first.objects.find((object) => object.type === 'lamp').color, '#c79a45');
  assert.equal(first.objects.find((object) => object.type === 'bed').x, first.objects.find((object) => object.type === 'window').x);
  assert.equal(first.objects.find((object) => object.type === 'window').z, -3.9);
  assert.equal(first.objects.find((object) => object.type === 'bed').z, first.objects.find((object) => object.type === 'window').z + 1.55);

  const changed = compileScene('Make the rug blue, remove the chair, and add a green plant beside the desk.', first.objects, true, { relations: first.graph.relations });
  assert.equal(changed.objects.find((object) => object.type === 'rug').color, '#537897');
  assert.equal(changed.objects.some((object) => object.type === 'chair'), false);
  assert.equal(changed.objects.find((object) => object.type === 'plant').color, '#55765a');
  assert.equal(changed.graph.relations.some((relation) => relation.type === 'beside' && relation.subjectType === 'plant'), true);
  assert.equal(changed.graph.relations.length, 3);
  assert.equal(changed.objects.find((object) => object.type === 'plant').z, changed.objects.find((object) => object.type === 'desk').z);
  assert.ok(Math.abs(Math.abs(changed.objects.find((object) => object.type === 'plant').x - changed.objects.find((object) => object.type === 'desk').x) - 1.8) < 1e-9);
  assert.deepEqual(new Set(changed.diagnostics.operations.map((operation) => operation.kind)), new Set(['recolor', 'remove', 'add', 'relate']));

  const collisionMoved = compileScene('A desk facing the door and a plant.');
  const movedDesk = collisionMoved.objects.find((object) => object.type === 'desk');
  const facingDoor = collisionMoved.objects.find((object) => object.type === 'door');
  assert.equal(movedDesk.rotation, Math.round(Math.atan2(facingDoor.x - movedDesk.x, facingDoor.z - movedDesk.z) * 180 / Math.PI));

  const sharedNeighbour = compileScene('A bed beneath the window, a table beside the bed and a chair beside the bed.');
  const neighbourTable = sharedNeighbour.objects.find((object) => object.type === 'table');
  const neighbourChair = sharedNeighbour.objects.find((object) => object.type === 'chair');
  const neighbourBed = sharedNeighbour.objects.find((object) => object.type === 'bed');
  assert.equal(sharedNeighbour.graph.relations.length, 3);
  assert.equal(sharedNeighbour.diagnostics.warnings.length, 0);
  assert.equal(neighbourTable.z, neighbourBed.z);
  assert.equal(neighbourChair.z, neighbourBed.z);
  assert.ok(Math.abs(neighbourTable.x - neighbourChair.x) >= (1.8 + 1) / 2 + .08);

  const pruned = compileScene('Remove the window and make the rug green.', changed.objects, true, { relations: changed.graph.relations });
  assert.equal(pruned.graph.relations.length, 2);
  assert.equal(pruned.graph.relations.some((relation) => relation.subjectType === 'bed' && relation.targetType === 'window'), false);
  assert.equal(pruned.diagnostics.operations.some((operation) => operation.kind === 'unrelate' && operation.reason === 'endpoint-removed'), true);

  const replaced = compileScene('Put the bed beside the window.', first.objects, true, { relations: first.graph.relations });
  assert.equal(replaced.graph.relations.some((relation) => relation.subjectType === 'bed' && relation.type === 'beneath'), false);
  assert.equal(replaced.graph.relations.some((relation) => relation.subjectType === 'bed' && relation.type === 'beside'), true);
  assert.equal(replaced.diagnostics.operations.some((operation) => operation.kind === 'relate' && operation.replaces === 'beneath'), true);

  const spanish = compileScene('Una cama bajo la ventana, una planta al lado del escritorio y el escritorio frente a la puerta.');
  assert.equal(spanish.diagnostics.valid, true);
  assert.equal(spanish.diagnostics.relations, 3);
  assert.equal(spanish.objects.find((object) => object.type === 'bed').x, spanish.objects.find((object) => object.type === 'window').x);

  const invalid = validateObjects([
    { id: 'same', type: 'bed', label: '', color: '#ffffff', x: 0, z: 0, rotation: 0 },
    { id: 'same', type: 'spaceship', color: 'red', x: 9, z: Number.NaN, rotation: Infinity }
  ]);
  assert.equal(invalid.valid, false);
  assert.match(invalid.errors.join(' '), /non-empty label/);
  assert.match(invalid.errors.join(' '), /duplicates id|unknown type|hex|outside room bounds|must be finite/);
});
