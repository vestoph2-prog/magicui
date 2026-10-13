import type { Equipment, EquipmentInput } from "../shared/model.ts";
import { all, defined, one, type Params, run } from "./db.ts";

const SELECT = `SELECT id, object_id AS objectId, type, model, serial, ip, mac,
  location, installed_at AS installedAt, notes, created_at AS createdAt
  FROM equipment`;

const ORDER = `ORDER BY CASE type WHEN 'nvr' THEN 0 WHEN 'router' THEN 1
  WHEN 'ont' THEN 2 WHEN 'switch' THEN 3 WHEN 'ups' THEN 4 WHEN 'camera' THEN 5
  ELSE 6 END, location, id`;

export const listEquipment = (objectId: number): Equipment[] =>
  all<Equipment>(`${SELECT} WHERE object_id = :objectId ${ORDER}`, {
    objectId,
  });

export const getEquipment = (id: number): Equipment | undefined =>
  one<Equipment>(`${SELECT} WHERE id = :id`, { id });

const params = (e: EquipmentInput): Params => ({
  type: e.type ?? "other",
  model: e.model ?? "",
  serial: e.serial ?? "",
  ip: e.ip ?? "",
  mac: e.mac ?? "",
  location: e.location ?? "",
  installedAt: e.installedAt ?? null,
  notes: e.notes ?? "",
});

export const createEquipment = (
  objectId: number,
  input: EquipmentInput
): number =>
  run(
    `INSERT INTO equipment (object_id, type, model, serial, ip, mac, location,
       installed_at, notes)
     VALUES (:objectId, :type, :model, :serial, :ip, :mac, :location,
       :installedAt, :notes)`,
    { objectId, ...params(input) }
  );

export const updateEquipment = (id: number, patch: EquipmentInput): void => {
  const current = getEquipment(id);
  if (!current) {
    return;
  }
  run(
    `UPDATE equipment SET type = :type, model = :model, serial = :serial,
       ip = :ip, mac = :mac, location = :location,
       installed_at = :installedAt, notes = :notes
     WHERE id = :id`,
    { id, ...params({ ...current, ...defined(patch) }) }
  );
};

export const deleteEquipment = (id: number): void => {
  run("DELETE FROM equipment WHERE id = :id", { id });
};
