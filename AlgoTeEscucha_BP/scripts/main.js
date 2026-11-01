import { world, system, ItemStack, EntityDamageCause } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";

const ID = "listener:the_listener";
const PAGE = "listener:unsent_page";
const PRESENCE_GOAL = 8 * 60 * 20;
const SPAWN_PERIOD = 200;

const BARS = [
  "action.listener.look",
  "action.listener.look.b",
  "action.listener.name",
  "action.listener.name.b",
  "action.listener.room",
  "action.listener.room.b",
  "action.listener.doors",
  "action.listener.quiet",
  "action.listener.quiet.b",
];

const WHISPERS = [
  "chat.listener.whisper.1",
  "chat.listener.whisper.2",
  "chat.listener.whisper.3",
  "chat.listener.whisper.4",
];

let warned = false;
function warn(error) {
  if (warned) return;
  warned = true;
  const message = error && error.message ? error.message : String(error);
  console.warn("[listener] " + message);
}

function num(target, key) {
  const value = target.getDynamicProperty(key);
  return typeof value === "number" ? value : 0;
}

function dist3(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function alive(entity) {
  try {
    return !!entity && entity.isValid();
  } catch (error) {
    try {
      return !!entity && !!entity.location;
    } catch (error2) {
      return false;
    }
  }
}

function isNight() {
  const time = world.getTimeOfDay();
  return time >= 12500 && time <= 23500;
}

function isOverworld(player) {
  const id = player.dimension.id;
  return id === "minecraft:overworld" || id === "overworld";
}

function blockAt(dim, x, y, z) {
  const iy = Math.floor(y);
  if (iy < -64 || iy > 319) return undefined;
  try {
    return dim.getBlock({ x: Math.floor(x), y: iy, z: Math.floor(z) });
  } catch (error) {
    return undefined;
  }
}

function isDangerId(id) {
  return (
    id === "minecraft:lava" ||
    id === "minecraft:flowing_lava" ||
    id === "minecraft:fire" ||
    id === "minecraft:soul_fire" ||
    id === "minecraft:cactus" ||
    id === "minecraft:magma" ||
    id === "minecraft:campfire" ||
    id === "minecraft:soul_campfire" ||
    id === "minecraft:sweet_berry_bush" ||
    id === "minecraft:wither_rose" ||
    id === "minecraft:powder_snow" ||
    id === "minecraft:pointed_dripstone"
  );
}

function isDanger(block) {
  return !!block && isDangerId(block.typeId);
}

function isWater(block) {
  if (!block) return false;
  const id = block.typeId;
  return id === "minecraft:water" || id === "minecraft:flowing_water";
}

function isLightSource(id) {
  if (id.indexOf("torch") !== -1) return true;
  if (id.indexOf("lantern") !== -1) return true;
  if (id.indexOf("candle") !== -1) return true;
  if (id.indexOf("froglight") !== -1) return true;
  if (id.indexOf("campfire") !== -1) return true;
  if (id.indexOf("_bulb") !== -1) return true;
  return (
    id === "minecraft:glowstone" ||
    id === "minecraft:sea_lantern" ||
    id === "minecraft:shroomlight" ||
    id === "minecraft:beacon" ||
    id === "minecraft:end_rod" ||
    id === "minecraft:fire" ||
    id === "minecraft:soul_fire" ||
    id === "minecraft:lava" ||
    id === "minecraft:flowing_lava" ||
    id === "minecraft:jack_o_lantern" ||
    id === "minecraft:lit_pumpkin" ||
    id === "minecraft:redstone_lamp" ||
    id === "minecraft:magma" ||
    id === "minecraft:respawn_anchor" ||
    id === "minecraft:conduit" ||
    id === "minecraft:ender_chest" ||
    id === "minecraft:light"
  );
}

function isPassable(block) {
  if (!block) return false;
  const id = block.typeId;
  if (
    id === "minecraft:air" ||
    id === "minecraft:cave_air" ||
    id === "minecraft:void_air" ||
    id === "minecraft:short_grass" ||
    id === "minecraft:grass" ||
    id === "minecraft:tall_grass" ||
    id === "minecraft:fern" ||
    id === "minecraft:large_fern" ||
    id === "minecraft:deadbush" ||
    id === "minecraft:vine" ||
    id === "minecraft:snow_layer" ||
    id === "minecraft:hanging_roots" ||
    id === "minecraft:glow_lichen" ||
    id === "minecraft:sculk_vein" ||
    id === "minecraft:moss_carpet" ||
    id === "minecraft:nether_sprouts" ||
    id === "minecraft:crimson_roots" ||
    id === "minecraft:warped_roots" ||
    id === "minecraft:structure_void" ||
    id === "minecraft:light"
  ) {
    return true;
  }
  if (id.endsWith("_carpet")) return true;
  if (id.indexOf("sapling") !== -1) return true;
  if (id.indexOf("mushroom") !== -1 && id.indexOf("block") === -1) return true;
  if (
    id.indexOf("flower") !== -1 ||
    id.indexOf("tulip") !== -1 ||
    id.indexOf("orchid") !== -1 ||
    id.indexOf("dandelion") !== -1 ||
    id.indexOf("poppy") !== -1 ||
    id.indexOf("allium") !== -1 ||
    id.indexOf("bluet") !== -1 ||
    id.indexOf("daisy") !== -1
  ) {
    return true;
  }
  if (id.endsWith("_button") || id.indexOf("pressure_plate") !== -1) return true;
  return false;
}

function floorReport(dim, x, feetY, z) {
  const y0 = Math.floor(feetY);
  let air = 0;
  for (let i = 1; i <= 8; i++) {
    const block = blockAt(dim, x, y0 - i, z);
    if (!block) return { hole: true, danger: false, water: false, air: 8 };
    if (isDanger(block)) return { hole: true, danger: true, water: false, air: air };
    if (isWater(block)) return { hole: false, danger: false, water: true, air: air };
    if (!isPassable(block)) return { hole: air >= 3, danger: false, water: false, air: air };
    air++;
  }
  return { hole: true, danger: false, water: false, air: 8 };
}

function isDoor(id) {
  if (!id || id.indexOf("door") === -1) return false;
  if (id.indexOf("iron") !== -1) return false;
  if (id.indexOf("copper") !== -1) return false;
  return true;
}

function isCovered(dim, x, y, z) {
  for (let i = 2; i <= 12; i++) {
    const block = blockAt(dim, x, y + i, z);
    if (block && !isPassable(block) && !isDoor(block.typeId)) return true;
  }
  return false;
}

function canStep(dim, x, y, z) {
  const feet = blockAt(dim, x, y, z);
  const head = blockAt(dim, x, y + 1, z);
  if (!feet || !head) return false;
  const feetOk = isPassable(feet) || isDoor(feet.typeId);
  const headOk = isPassable(head) || isDoor(head.typeId);
  if (!feetOk || !headOk) return false;
  if (isDanger(feet) || isDanger(head) || isWater(feet)) return false;
  const floor = floorReport(dim, x, y, z);
  if (floor.danger || floor.water) return false;
  if (floor.hole && floor.air >= 3) return false;
  return true;
}

function isSafeStand(dim, x, y, z) {
  const feet = blockAt(dim, x, y, z);
  const head = blockAt(dim, x, y + 1, z);
  if (!feet || !head) return false;
  if (!isPassable(feet) || !isPassable(head)) return false;
  if (isDanger(feet) || isDanger(head) || isWater(feet)) return false;
  const floor = floorReport(dim, x, y, z);
  if (floor.hole || floor.danger || floor.water) return false;
  const sides = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  for (let i = 0; i < sides.length; i++) {
    const side = blockAt(dim, x + sides[i][0], y, z + sides[i][1]);
    if (!side) continue;
    const id = side.typeId;
    if (
      id === "minecraft:lava" ||
      id === "minecraft:flowing_lava" ||
      id === "minecraft:fire" ||
      id === "minecraft:soul_fire" ||
      id === "minecraft:cactus"
    ) {
      return false;
    }
  }
  return true;
}

function areaDark(dim, x, y, z) {
  const spots = [
    [0, 0],
    [2, 0],
    [-2, 0],
    [0, 2],
    [0, -2],
    [4, 0],
    [-4, 0],
    [0, 4],
    [0, -4],
    [3, 3],
    [-3, -3],
  ];
  for (let i = 0; i < spots.length; i++) {
    for (let dy = 0; dy <= 2; dy++) {
      const block = blockAt(dim, x + spots[i][0], y + dy, z + spots[i][1]);
      if (block && isLightSource(block.typeId)) return false;
    }
  }
  return true;
}

function settle(dim, x, y, z) {
  const start = Math.floor(y) + 3;
  for (let i = 0; i < 12; i++) {
    const yy = start - i;
    if (isSafeStand(dim, x, yy, z)) return { x: x, y: yy, z: z };
  }
  return undefined;
}

function heading(entity) {
  try {
    const vel = entity.getVelocity();
    const speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
    if (speed > 0.04) return { x: vel.x / speed, z: vel.z / speed };
  } catch (error) {}
  try {
    const view = entity.getViewDirection();
    const speed = Math.sqrt(view.x * view.x + view.z * view.z) || 1;
    return { x: view.x / speed, z: view.z / speed };
  } catch (error) {
    return { x: 0, z: 1 };
  }
}

function hazardAhead(entity) {
  const dim = entity.dimension;
  const loc = entity.location;
  const dir = heading(entity);
  const steps = [0.9, 1.8];
  for (let i = 0; i < steps.length; i++) {
    const x = loc.x + dir.x * steps[i];
    const z = loc.z + dir.z * steps[i];
    const feet = blockAt(dim, x, loc.y, z);
    if (feet && isDanger(feet)) {
      return feet.typeId.indexOf("cactus") !== -1 ? "cactus" : "hurt";
    }
    const floor = floorReport(dim, x, loc.y, z);
    if (floor.danger) return "hurt";
    if (floor.hole) return "hole";
  }
  return undefined;
}

function steerOffHazard(entity) {
  const dim = entity.dimension;
  const loc = entity.location;
  const dir = heading(entity);
  const options = [
    { x: loc.x - dir.z, z: loc.z + dir.x },
    { x: loc.x + dir.z, z: loc.z - dir.x },
    { x: loc.x - dir.x * 0.9, z: loc.z - dir.z * 0.9 },
  ];
  for (let i = 0; i < options.length; i++) {
    const spot = options[i];
    if (isSafeStand(dim, spot.x, loc.y, spot.z)) {
      entity.teleport({ x: spot.x, y: loc.y, z: spot.z }, { keepVelocity: false });
      return true;
    }
  }
  return false;
}

function rememberSafe(entity) {
  let velY = 0;
  try {
    velY = entity.getVelocity().y;
  } catch (error) {}
  if (Math.abs(velY) > 0.22) return;
  const loc = entity.location;
  if (!isSafeStand(entity.dimension, loc.x, loc.y, loc.z)) return;
  entity.setDynamicProperty("listener:sx", loc.x);
  entity.setDynamicProperty("listener:sy", loc.y);
  entity.setDynamicProperty("listener:sz", loc.z);
}

function readSafe(entity) {
  const x = entity.getDynamicProperty("listener:sx");
  const y = entity.getDynamicProperty("listener:sy");
  const z = entity.getDynamicProperty("listener:sz");
  if (typeof x !== "number" || typeof y !== "number" || typeof z !== "number") return undefined;
  return { x: x, y: y, z: z };
}

function pullFromLedge(entity) {
  let vel;
  try {
    vel = entity.getVelocity();
  } catch (error) {
    return;
  }
  const horiz = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
  if (vel.y > -0.42 || horiz > 0.34) return;
  const loc = entity.location;
  const floor = floorReport(entity.dimension, loc.x, loc.y, loc.z);
  if (!floor.hole && !floor.danger) return;
  const safe = readSafe(entity);
  if (!safe) return;
  if (dist3(loc, safe) > 8) return;
  entity.teleport(safe, { keepVelocity: false });
}

function tryOpenDoor(entity) {
  const dim = entity.dimension;
  const loc = entity.location;
  let view;
  try {
    view = entity.getViewDirection();
  } catch (error) {
    return;
  }
  const samples = [
    blockAt(dim, loc.x + view.x, loc.y + 0.4, loc.z + view.z),
    blockAt(dim, loc.x + view.x, loc.y + 1.4, loc.z + view.z),
  ];
  for (let i = 0; i < samples.length; i++) {
    const block = samples[i];
    if (!block) continue;
    const id = block.typeId;
    if (!id.endsWith("_door")) continue;
    if (id.indexOf("iron") !== -1 || id.indexOf("copper") !== -1) continue;
    try {
      const perm = block.permutation;
      if (perm.getState("open_bit") === false) {
        block.setPermutation(perm.withState("open_bit", true));
      }
    } catch (error) {}
  }
}

function setState(entity, state) {
  if (entity.getDynamicProperty("listener:state") === state) return;
  entity.setDynamicProperty("listener:state", state);
  try {
    entity.triggerEvent("listener:set_" + state);
  } catch (error) {}
}

function eyeContact(player, entity) {
  let head;
  let view;
  try {
    head = player.getHeadLocation();
    view = player.getViewDirection();
  } catch (error) {
    return false;
  }
  const heights = [1.4, 2.5, 3.45];
  let matchedDist = 0;
  for (let i = 0; i < heights.length; i++) {
    const dx = entity.location.x - head.x;
    const dy = entity.location.y + heights[i] - head.y;
    const dz = entity.location.z - head.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist < 0.75 || dist > 26) continue;
    const dot = (dx / dist) * view.x + (dy / dist) * view.y + (dz / dist) * view.z;
    if (dot < 0.82) continue;
    matchedDist = dist;
    break;
  }
  if (matchedDist === 0) return false;
  try {
    const hit = player.dimension.getBlockFromRay(head, view, {
      maxDistance: matchedDist,
      includePassableBlocks: false,
      includeLiquidBlocks: false,
    });
    if (hit && hit.block) {
      const block = hit.block.location;
      const hx = block.x + 0.5 - head.x;
      const hy = block.y + 0.5 - head.y;
      const hz = block.z + 0.5 - head.z;
      const hd = Math.sqrt(hx * hx + hy * hy + hz * hz);
      if (hd < matchedDist - 1.25) return false;
    }
  } catch (error) {}
  return true;
}

function closestPlayer(entity, maxDist) {
  let players;
  try {
    players = entity.dimension.getPlayers({ location: entity.location, maxDistance: maxDist });
  } catch (error) {
    try {
      players = entity.dimension.getPlayers();
    } catch (error2) {
      return undefined;
    }
  }
  let best;
  let bestDist = maxDist;
  for (let i = 0; i < players.length; i++) {
    const player = players[i];
    const d = dist3(entity.location, player.location);
    if (d < bestDist) {
      bestDist = d;
      best = player;
    }
  }
  return best;
}

function nearestListener(player) {
  let list;
  try {
    list = player.dimension.getEntities({
      type: ID,
      location: player.location,
      maxDistance: 48,
    });
  } catch (error) {
    return undefined;
  }
  let best;
  let bestDist = 99;
  for (let i = 0; i < list.length; i++) {
    const d = dist3(player.location, list[i].location);
    if (d < bestDist) {
      bestDist = d;
      best = list[i];
    }
  }
  if (!best) return undefined;
  return { entity: best, dist: bestDist };
}

function showPage(player) {
  try {
    const form = new ActionFormData();
    form.title({ translate: "book.listener.title" });
    form.body({ translate: "book.listener.body" });
    form.button({ translate: "book.listener.close" });
    form.show(player).catch(function () {});
  } catch (error) {
    try {
      player.sendMessage({ translate: "book.listener.body" });
    } catch (error2) {}
  }
}

function givePage(player) {
  if (player.getDynamicProperty("listener:known") === true) return;
  player.setDynamicProperty("listener:known", true);
  try {
    const inventory = player.getComponent("minecraft:inventory") || player.getComponent("inventory");
    if (inventory && inventory.container) {
      inventory.container.addItem(new ItemStack(PAGE, 1));
    }
  } catch (error) {}
  try {
    player.sendMessage({ translate: "chat.listener.found" });
    player.playSound("listener.page", { volume: 0.75, pitch: 0.92 });
  } catch (error) {}
  system.runTimeout(function () {
    try {
      showPage(player);
    } catch (error) {}
  }, 30);
}

function actionBar(player, key) {
  try {
    player.onScreenDisplay.setActionBar({ translate: key });
  } catch (error) {
    try {
      player.onScreenDisplay.setActionBar("No mires atrás");
    } catch (error2) {}
  }
}

function maybeMood(player, dist, looking, now) {
  if (dist > 22) return;
  if (dist < 16 && now >= num(player, "listener:msg_at") && Math.random() < 0.4) {
    actionBar(player, BARS[Math.floor(Math.random() * BARS.length)]);
    player.setDynamicProperty("listener:msg_at", now + 100 + Math.floor(Math.random() * 90));
  }
  if (dist < 7 && !looking && now >= num(player, "listener:title_at") && Math.random() < 0.16) {
    try {
      player.onScreenDisplay.setTitle(
        { translate: "title.listener.close" },
        { fadeInDuration: 12, stayDuration: 16, fadeOutDuration: 30 }
      );
    } catch (error) {}
    player.setDynamicProperty("listener:title_at", now + 460);
  }
  if (dist < 6 && now >= num(player, "listener:nausea_at")) {
    try {
      player.addEffect("nausea", 70, { amplifier: 0, showParticles: false });
    } catch (error) {}
    if (dist < 4.2) {
      try {
        player.runCommand("camerashake add @s 0.05 0.8 rotational");
      } catch (error) {}
    }
    player.setDynamicProperty("listener:nausea_at", now + 260);
  }
  if (dist < 18 && now >= num(player, "listener:chat_at") && Math.random() < 0.2) {
    try {
      if (Math.random() < 0.16) {
        player.sendMessage({
          rawtext: [{ text: "§8§o< " + player.name + " > " }, { translate: "chat.listener.fake.tail" }],
        });
      } else {
        player.sendMessage({ translate: WHISPERS[Math.floor(Math.random() * WHISPERS.length)] });
      }
    } catch (error) {}
    player.setDynamicProperty("listener:chat_at", now + 560 + Math.floor(Math.random() * 400));
  }
  if (player.getDynamicProperty("listener:known") !== true && dist < 14) givePage(player);
  if (looking && player.getDynamicProperty("listener:locked") !== true) {
    player.setDynamicProperty("listener:locked", true);
    try {
      player.playSound("listener.sting", { volume: 0.3, pitch: 0.82 });
    } catch (error) {}
  }
  if (!looking && dist > 32) player.setDynamicProperty("listener:locked", false);
}

function movedSince(entity) {
  const x = entity.location.x;
  const z = entity.location.z;
  const px = entity.getDynamicProperty("listener:px");
  const pz = entity.getDynamicProperty("listener:pz");
  entity.setDynamicProperty("listener:px", x);
  entity.setDynamicProperty("listener:pz", z);
  if (typeof px !== "number" || typeof pz !== "number") return 0;
  return Math.sqrt((x - px) * (x - px) + (z - pz) * (z - pz));
}

function ambientSounds(entity, dist, looking, now) {
  if (looking && dist < 18) return;
  if (dist < 13 && now >= num(entity, "listener:breath_at")) {
    try {
      entity.dimension.playSound("listener.breath", entity.location, {
        volume: dist < 6 ? 0.75 : 0.42,
        pitch: 0.8 + Math.random() * 0.18,
      });
    } catch (error) {}
    entity.setDynamicProperty("listener:breath_at", now + 55 + Math.floor(Math.random() * 45));
  }
  const running = entity.getDynamicProperty("listener:state") === "hunt";
  if (running) {
    movedSince(entity);
  } else if (dist < 16 && now >= num(entity, "listener:step_at")) {
    const moved = movedSince(entity);
    if (moved > 0.11 || (dist < 10 && !looking && Math.random() < 0.12)) {
      try {
        entity.dimension.playSound("listener.step", entity.location, {
          volume: 0.85,
          pitch: 0.98 + Math.random() * 0.04,
        });
      } catch (error) {}
    }
    entity.setDynamicProperty("listener:step_at", now + 200 + Math.floor(Math.random() * 200));
  } else if (dist >= 16) {
    movedSince(entity);
  }
  if (dist < 11 && !looking && Math.random() < 0.035) {
    try {
      entity.dimension.playSound("listener.whisper", entity.location, {
        volume: 0.32,
        pitch: 0.78 + Math.random() * 0.25,
      });
    } catch (error) {}
  }
}

function yawToward(from, to) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  return (Math.atan2(dz, dx) * 180) / Math.PI - 90;
}

function tryBlink(entity, player, now) {
  if (now < num(entity, "listener:tp_at")) return;
  entity.setDynamicProperty("listener:tp_at", now + 420 + Math.floor(Math.random() * 520));
  if (Math.random() > 0.7) return;
  const spot = Math.random() < 0.62 ? spotBehind(player) : spotBeside(entity, player);
  if (!spot) return;
  const hop = dist3(entity.location, spot);
  if (hop < 3.2 || hop > 13) return;
  try {
    entity.teleport(spot, {
      keepVelocity: false,
      rotation: { x: 0, y: yawToward(spot, player.location) },
    });
  } catch (error) {
    return;
  }
  entity.setDynamicProperty("listener:calm_until", now + 55);
  setState(entity, "stalk");
  try {
    entity.dimension.playSound("listener.teleport", spot, {
      volume: 0.4,
      pitch: 0.7 + Math.random() * 0.2,
    });
  } catch (error) {}
  if (dist3(player.location, spot) < 6.5) {
    try {
      player.addEffect("darkness", 28, { amplifier: 0, showParticles: false });
    } catch (error) {}
  }
}

function spotBehind(player) {
  let view;
  try {
    view = player.getViewDirection();
  } catch (error) {
    return undefined;
  }
  const reach = 4.2 + Math.random() * 2.6;
  const x = player.location.x - view.x * reach + (Math.random() - 0.5) * 1.4;
  const z = player.location.z - view.z * reach + (Math.random() - 0.5) * 1.4;
  const spot = settle(player.dimension, x, player.location.y, z);
  if (!spot) return undefined;
  if (!areaDark(player.dimension, spot.x, spot.y, spot.z) && Math.random() < 0.65) return undefined;
  return spot;
}

function spotBeside(entity, player) {
  const dim = entity.dimension;
  for (let i = 0; i < 6; i++) {
    const ang = Math.random() * Math.PI * 2;
    const reach = 6 + Math.random() * 5;
    const x = entity.location.x + Math.cos(ang) * reach;
    const z = entity.location.z + Math.sin(ang) * reach;
    const spot = settle(dim, x, entity.location.y, z);
    if (!spot) continue;
    if (dist3(spot, player.location) < 4) continue;
    if (!areaDark(dim, spot.x, spot.y, spot.z)) continue;
    return spot;
  }
  return undefined;
}

function findSpawnSpot(player, cave) {
  const dim = player.dimension;
  const base = player.location;
  const shifts = cave ? [0, -4, -8, -12, -18, -24, -32] : [0, 2, -2, -6];
  const minDist = cave ? 12 : 22;
  const reachMin = cave ? 12 : 26;
  const reachSpan = cave ? 18 : 16;
  const tries = cave ? 18 : 12;
  for (let i = 0; i < tries; i++) {
    const ang = Math.random() * Math.PI * 2;
    const reach = reachMin + Math.random() * reachSpan;
    const x = base.x + Math.cos(ang) * reach;
    const z = base.z + Math.sin(ang) * reach;
    const shift = shifts[Math.floor(Math.random() * shifts.length)];
    const spot = settle(dim, x, base.y + shift, z);
    if (!spot) continue;
    const d = dist3(spot, base);
    if (d < minDist || d > 46) continue;
    if (!areaDark(dim, spot.x, spot.y, spot.z)) continue;
    if (cave && !isCovered(dim, spot.x, spot.y, spot.z)) continue;
    return spot;
  }
  return undefined;
}

function findFleeSpot(entity) {
  const dim = entity.dimension;
  for (let i = 0; i < 8; i++) {
    const ang = Math.random() * Math.PI * 2;
    const reach = 8 + Math.random() * 6;
    const x = entity.location.x + Math.cos(ang) * reach;
    const z = entity.location.z + Math.sin(ang) * reach;
    const spot = settle(dim, x, entity.location.y, z);
    if (!spot) continue;
    if (isDanger(blockAt(dim, spot.x, spot.y, spot.z))) continue;
    return spot;
  }
  return undefined;
}

function openDoorBlock(block) {
  if (!block || !isDoor(block.typeId)) return;
  try {
    const perm = block.permutation;
    if (perm.getState("open_bit") === false) {
      block.setPermutation(perm.withState("open_bit", true));
    }
  } catch (error) {}
}

function inDanger(entity) {
  const dim = entity.dimension;
  const loc = entity.location;
  const feet = blockAt(dim, loc.x, loc.y, loc.z);
  if (isDanger(feet) || isWater(feet)) return true;
  const below = blockAt(dim, loc.x, loc.y - 0.15, loc.z);
  if (isDanger(below)) return true;
  return false;
}

function groundY(dim, x, y, z) {
  const start = Math.floor(y) + 1;
  for (let i = 0; i < 4; i++) {
    const yy = start - i;
    if (!canStep(dim, x, yy, z)) continue;
    const below = blockAt(dim, x, yy - 1, z);
    if (!below) continue;
    if (isPassable(below) || isDoor(below.typeId)) continue;
    if (isDanger(below) || isWater(below)) continue;
    return yy;
  }
  return undefined;
}

function stepToward(entity, player, speed) {
  const loc = entity.location;
  const dx = player.location.x - loc.x;
  const dz = player.location.z - loc.z;
  const horiz = Math.sqrt(dx * dx + dz * dz);
  if (horiz < 1.25) return false;
  const nx = dx / horiz;
  const nz = dz / horiz;
  const dim = entity.dimension;
  openDoorBlock(blockAt(dim, loc.x + nx, loc.y, loc.z + nz));
  openDoorBlock(blockAt(dim, loc.x + nx, loc.y + 1, loc.z + nz));
  let tx = loc.x + nx * speed;
  let tz = loc.z + nz * speed;
  let gy = groundY(dim, tx, loc.y, tz);
  if (gy === undefined) {
    tryOpenDoor(entity);
    tx = loc.x + nx * 0.5;
    tz = loc.z + nz * 0.5;
    gy = groundY(dim, tx, loc.y, tz);
    if (gy === undefined) return false;
  }
  try {
    entity.teleport(
      { x: tx, y: gy, z: tz },
      { keepVelocity: false, rotation: { x: 0, y: yawToward(loc, player.location) } }
    );
  } catch (error) {
    return false;
  }
  return true;
}

function stepAway(entity, player) {
  const loc = entity.location;
  const dx = loc.x - player.location.x;
  const dz = loc.z - player.location.z;
  const horiz = Math.sqrt(dx * dx + dz * dz) || 1;
  if (horiz > 11) return false;
  const nx = dx / horiz;
  const nz = dz / horiz;
  const tx = loc.x + nx * 0.16;
  const tz = loc.z + nz * 0.16;
  const gy = groundY(entity.dimension, tx, loc.y, tz);
  if (gy === undefined) return false;
  try {
    entity.teleport(
      { x: tx, y: gy, z: tz },
      { keepVelocity: false, rotation: { x: 0, y: yawToward(loc, player.location) } }
    );
  } catch (error) {
    return false;
  }
  return true;
}

const SURFACE_AMBUSH = 0.25;
const CAVE_AMBUSH = SURFACE_AMBUSH * 1.3;

function unmetPlayer(entity) {
  let players;
  try {
    players = entity.dimension.getPlayers({ location: entity.location, maxDistance: 48 });
  } catch (error) {
    const one = closestPlayer(entity, 48);
    if (one && one.getDynamicProperty("listener:met") !== 1) return one;
    return undefined;
  }
  let best;
  let bestDist = 99;
  for (let i = 0; i < players.length; i++) {
    const player = players[i];
    if (player.getDynamicProperty("listener:met") === 1) continue;
    const d = dist3(entity.location, player.location);
    if (d < bestDist) {
      bestDist = d;
      best = player;
    }
  }
  return best;
}

function behindPlayer(player) {
  let view;
  try {
    view = player.getViewDirection();
  } catch (error) {
    view = { x: 0, y: 0, z: 1 };
  }
  const x = player.location.x - view.x * 2.2;
  const z = player.location.z - view.z * 2.2;
  const spot = settle(player.dimension, x, player.location.y, z);
  if (spot) return spot;
  return { x: x, y: player.location.y, z: z };
}

function wantsAmbush(entity, player) {
  if (entity.getDynamicProperty("listener:ambush") === 1) return true;
  if (entity.getDynamicProperty("listener:ambush_set") === 1) return false;
  entity.setDynamicProperty("listener:ambush_set", 1);
  const loc = player.location;
  const cave = isCovered(player.dimension, loc.x, loc.y, loc.z);
  const chance = cave ? CAVE_AMBUSH : SURFACE_AMBUSH;
  if (Math.random() < chance) {
    entity.setDynamicProperty("listener:ambush", 1);
    return true;
  }
  return false;
}

function strikeSeeYou(entity, player, now) {
  if (num(entity, "listener:striking") === 1) return;
  entity.setDynamicProperty("listener:striking", 1);
  const spot = behindPlayer(player);
  try {
    entity.teleport(spot, {
      keepVelocity: false,
      rotation: { x: 0, y: yawToward(spot, player.location) },
    });
  } catch (error) {}
  try {
    player.addEffect("blindness", 36, { amplifier: 0, showParticles: false });
  } catch (error) {}
  try {
    player.addEffect("darkness", 110, { amplifier: 1, showParticles: false });
  } catch (error) {}
  try {
    player.playSound("listener.iseeyou", { volume: 1, pitch: 1 });
  } catch (error) {}
  try {
    player.onScreenDisplay.setTitle("i see you", {
      fadeInDuration: 0,
      stayDuration: 28,
      fadeOutDuration: 16,
    });
  } catch (error) {}
  try {
    player.applyDamage(8, { cause: EntityDamageCause.entityAttack, damagingEntity: entity });
  } catch (error) {}
  player.setDynamicProperty("listener:met", 1);
  player.setDynamicProperty("listener:music_at", now + 160);
  entity.setDynamicProperty("listener:vanish_at", now + 14);
}

function scareArrival(entity, now) {
  if (num(entity, "listener:announced") === 1) return;
  let players;
  try {
    players = entity.dimension.getPlayers({ location: entity.location, maxDistance: 56 });
  } catch (error) {
    const one = closestPlayer(entity, 56);
    players = one ? [one] : [];
  }
  if (!players || players.length === 0) return;
  entity.setDynamicProperty("listener:announced", 1);
  for (let i = 0; i < players.length; i++) {
    const player = players[i];
    try {
      player.addEffect("blindness", 40, { amplifier: 0, showParticles: false });
    } catch (error) {}
    try {
      player.addEffect("darkness", 220, { amplifier: 0, showParticles: false });
    } catch (error) {}
    try {
      player.playSound("listener.pulse", { volume: 0.92, pitch: 1 });
    } catch (error) {}
    player.setDynamicProperty("listener:music_at", now + 180);
  }
}

const SPEED_CAP = 0.22;

function worldDay() {
  try {
    return Math.floor(world.getAbsoluteTime() / 24000);
  } catch (error) {
    return 0;
  }
}

function noteNight(player) {
  const day = worldDay();
  const seen = player.getDynamicProperty("listener:day_seen");
  if (typeof seen === "number" && day > seen) {
    const add = Math.min(8, day - seen);
    player.setDynamicProperty("listener:nights", Math.min(8, num(player, "listener:nights") + add));
  }
  if (seen !== day) player.setDynamicProperty("listener:day_seen", day);
}

function huntSpeed(player) {
  const nights = Math.max(0, Math.min(8, num(player, "listener:nights")));
  return Math.min(SPEED_CAP, 0.15 + nights * 0.00875);
}

function cutMetal(player) {
  try {
    player.runCommand("stopsound @s listener.charge");
    player.runCommand("stopsound @s listener.step");
  } catch (error) {}
}

function metalAt(dim, pos, volume, pitch) {
  const clamped = Math.max(0.92, Math.min(1.06, pitch));
  try {
    dim.playSound("listener.charge", pos, { volume: volume, pitch: clamped });
  } catch (error) {}
}

function sayName(player, now) {
  const day = worldDay();
  if (player.getDynamicProperty("listener:named_on") === day) return;
  if (now < num(player, "listener:name_at")) return;
  player.setDynamicProperty("listener:named_on", day);
  player.setDynamicProperty("listener:name_at", now + 200);
  const name = player.name || "";
  try {
    player.sendMessage({ translate: "chat.listener.named", with: [name] });
  } catch (error) {
    try {
      player.sendMessage("§8§o" + name + "…");
    } catch (error2) {}
  }
  try {
    player.playSound("listener.whisper", { volume: 0.4, pitch: 0.9 });
  } catch (error) {}
}

function isTorch(id) {
  return (
    id === "minecraft:torch" ||
    id === "minecraft:wall_torch" ||
    id === "minecraft:soul_torch" ||
    id === "minecraft:soul_wall_torch"
  );
}

function snuffOneTorch(entity, now) {
  if (now < num(entity, "listener:snuff_at")) return;
  const dim = entity.dimension;
  const loc = entity.location;
  let best;
  let bestD = 3.6;
  for (let dy = -1; dy <= 2; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      for (let dz = -3; dz <= 3; dz++) {
        const block = blockAt(dim, loc.x + dx, loc.y + dy, loc.z + dz);
        if (!block || !isTorch(block.typeId)) continue;
        const at = block.location;
        const d = dist3(loc, { x: at.x + 0.5, y: at.y + 0.5, z: at.z + 0.5 });
        if (d < bestD) {
          bestD = d;
          best = block;
        }
      }
    }
  }
  if (!best) return;
  const at = best.location;
  let cleared = false;
  try {
    best.setType("minecraft:air");
    cleared = true;
  } catch (error) {
    try {
      dim.runCommand("setblock " + at.x + " " + at.y + " " + at.z + " air");
      cleared = true;
    } catch (error2) {}
  }
  if (!cleared) return;
  entity.setDynamicProperty("listener:snuff_at", now + 300);
  metalAt(dim, { x: at.x + 0.5, y: at.y, z: at.z + 0.5 }, 0.6, 1);
}

function stepsBehind(player, entity, now, looking) {
  if (looking) {
    cutMetal(player);
    return;
  }
  if (dist3(player.location, entity.location) < 8) return;
  if (now < num(player, "listener:behind_at")) return;
  let view;
  try {
    view = player.getViewDirection();
  } catch (error) {
    return;
  }
  const reach = 2.6 + Math.random();
  metalAt(
    player.dimension,
    {
      x: player.location.x - view.x * reach,
      y: player.location.y,
      z: player.location.z - view.z * reach,
    },
    0.9,
    1
  );
  player.setDynamicProperty("listener:behind_at", now + 200 + Math.floor(Math.random() * 200));
}

function denySleep(player, entity, now) {
  if (now < num(player, "listener:wake_at")) return;
  let sleeping = false;
  try {
    sleeping = player.isSleeping === true;
  } catch (error) {
    return;
  }
  if (!sleeping) return;
  if (dist3(player.location, entity.location) > 32) return;
  const loc = player.location;
  try {
    player.teleport({ x: loc.x, y: loc.y + 0.15, z: loc.z }, { keepVelocity: false });
  } catch (error) {}
  player.setDynamicProperty("listener:wake_at", now + 80);
  try {
    player.sendMessage({ translate: "chat.listener.wake" });
  } catch (error) {}
  try {
    player.addEffect("darkness", 70, { amplifier: 0, showParticles: false });
  } catch (error) {}
  metalAt(player.dimension, loc, 0.75, 1);
}

function chaseTick(entity, now) {
  if (!alive(entity)) return;
  if (num(entity, "listener:vanish_at") > 0) return;
  if (entity.getDynamicProperty("listener:from_song") !== 1 && unmetPlayer(entity)) return;
  if (inDanger(entity)) return;
  const player = closestPlayer(entity, 48);
  if (!player) return;
  if (now < num(entity, "listener:retreat_until")) {
    stepAway(entity, player);
    return;
  }
  if (now < num(entity, "listener:yield_until")) return;
  if (eyeContact(player, entity)) {
    cutMetal(player);
    if (dist3(entity.location, player.location) <= 7 && now >= num(entity, "listener:yield_until")) {
      stepAway(entity, player);
    }
    return;
  }
  let state = entity.getDynamicProperty("listener:state");
  const d = dist3(entity.location, player.location);
  if (d < 36 && now >= num(entity, "listener:calm_until")) {
    if (state !== "hunt") setState(entity, "hunt");
    state = "hunt";
  } else if (state !== "hunt" && state !== "stalk") {
    state = "stalk";
    setState(entity, state);
  }
  let speed = state === "hunt" ? huntSpeed(player) : 0.08;
  if (speed > SPEED_CAP) speed = SPEED_CAP;
  if (entity.getDynamicProperty("listener:ambush") === 1 && d < 20) return;
  const moved = stepToward(entity, player, speed);
  if (moved && d < 8 && now >= num(entity, "listener:charge_at")) {
    metalAt(entity.dimension, entity.location, state === "hunt" ? 1 : 0.7, 1);
    entity.setDynamicProperty("listener:charge_at", now + 200 + Math.floor(Math.random() * 200));
  }
  if (moved && now % 20 === 0) snuffOneTorch(entity, now);
  if (state === "hunt" && d < 2.15 && now >= num(entity, "listener:hit_at")) {
    try {
      player.applyDamage(8, { cause: EntityDamageCause.entityAttack, damagingEntity: entity });
    } catch (error) {}
    entity.setDynamicProperty("listener:hit_at", now + 48);
  }
}

function tickEntity(entity, now) {
  if (!alive(entity)) return;
  const loc = entity.location;
  if (loc.y < -60) {
    const safe = readSafe(entity);
    if (safe) {
      try {
        entity.teleport(safe, { keepVelocity: false });
      } catch (error) {}
    }
    return;
  }

  rememberSafe(entity);
  const vanish = num(entity, "listener:vanish_at");
  if (vanish > 0) {
    if (now >= vanish) {
      try {
        entity.remove();
      } catch (error) {}
    }
    return;
  }
  const fresh = entity.getDynamicProperty("listener:from_song") === 1 ? undefined : unmetPlayer(entity);
  if (fresh) {
    strikeSeeYou(entity, fresh, now);
    return;
  }
  const player = closestPlayer(entity, 48);

  if (!player) {
    const lost = num(entity, "listener:lost") + 10;
    entity.setDynamicProperty("listener:lost", lost);
    if (lost > 400 || !isNight()) {
      try {
        entity.remove();
      } catch (error) {}
      return;
    }
    setState(entity, "stalk");
    return;
  }
  if (num(entity, "listener:lost") !== 0) entity.setDynamicProperty("listener:lost", 0);

  const d = dist3(loc, player.location);
  if (wantsAmbush(entity, player)) {
    if (d < 20) {
      strikeSeeYou(entity, player, now);
      return;
    }
  } else {
    scareArrival(entity, now);
  }

  if (!isNight() && d > 52) {
    try {
      entity.remove();
    } catch (error) {}
    return;
  }

  const looking = eyeContact(player, entity);
  pullFromLedge(entity);

  if (!looking && hazardAhead(entity) && now >= num(entity, "listener:yield_until")) {
    entity.setDynamicProperty("listener:yield_until", now + 28);
    entity.setDynamicProperty("listener:retreat_until", now + 28);
    setState(entity, "retreat");
    steerOffHazard(entity);
  }

  const stateNow = entity.getDynamicProperty("listener:state");
  if ((stateNow === "hunt" || stateNow === "stalk" || stateNow === "retreat") && now % 20 < 10) {
    tryOpenDoor(entity);
  }

  if (looking && d <= 7) setState(entity, "retreat");
  else if (looking) setState(entity, "watched");
  else if (now < num(entity, "listener:retreat_until") || now < num(entity, "listener:yield_until")) {
    setState(entity, "retreat");
  } else if (now < num(entity, "listener:calm_until")) setState(entity, "stalk");
  else if (d < 36) setState(entity, "hunt");
  else setState(entity, "stalk");

  const after = entity.getDynamicProperty("listener:state");
  if (!looking && d > 8 && d < 34 && (after === "stalk" || after === "hunt") && now % 40 < 10) {
    tryBlink(entity, player, now);
  }

  ambientSounds(entity, d, looking, now);
  maybeMood(player, d, looking, now);
  if (entity.getDynamicProperty("listener:ambush") !== 1 && !looking && d > 5 && d < 18) sayName(player, now);
  stepsBehind(player, entity, now, looking);
  denySleep(player, entity, now);
}

function tickPresence(now) {
  const players = world.getPlayers();
  for (let i = 0; i < players.length; i++) {
    const player = players[i];
    const last = player.getDynamicProperty("listener:last_tick");
    const prev = typeof last === "number" ? last : now;
    const delta = Math.max(0, Math.min(40, now - prev));
    player.setDynamicProperty("listener:last_tick", now);
    player.setDynamicProperty("listener:presence", num(player, "listener:presence") + delta);
    noteNight(player);
  }
}

function solidRoof(block) {
  if (!block || isPassable(block) || isDoor(block.typeId)) return false;
  const id = block.typeId;
  if (id.indexOf("leaves") !== -1 || id.indexOf("log") !== -1) return false;
  return true;
}

function lowCeiling(dim, x, y, z) {
  for (let i = 2; i <= 5; i++) {
    if (solidRoof(blockAt(dim, x, y + i, z))) return true;
  }
  return false;
}

function isEnclosed(dim, x, y, z) {
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  let walls = 0;
  for (let i = 0; i < dirs.length; i++) {
    const dx = dirs[i][0];
    const dz = dirs[i][1];
    for (let s = 1; s <= 4; s++) {
      const feet = blockAt(dim, x + dx * s, y, z + dz * s);
      const head = blockAt(dim, x + dx * s, y + 1, z + dz * s);
      if (solidRoof(feet) || solidRoof(head)) {
        walls++;
        break;
      }
    }
  }
  return walls >= 3;
}

function hasNearbyLight(dim, x, y, z) {
  const y0 = Math.floor(y);
  for (let dy = -1; dy <= 2; dy++) {
    for (let dz = -4; dz <= 4; dz++) {
      for (let dx = -4; dx <= 4; dx++) {
        if (dx * dx + dz * dz > 18) continue;
        const block = blockAt(dim, x + dx, y0 + dy, z + dz);
        if (block && isLightSource(block.typeId)) return true;
      }
    }
  }
  return false;
}

function floorPlace(player) {
  const loc = player.location;
  const dim = player.dimension;
  const cave = loc.y < 52 || (isCovered(dim, loc.x, loc.y, loc.z) && loc.y < 64);
  const closed = isEnclosed(dim, loc.x, loc.y, loc.z) || lowCeiling(dim, loc.x, loc.y, loc.z);
  if (!cave && !closed) return false;
  return !hasNearbyLight(dim, loc.x, loc.y, loc.z);
}

function cutFloor(player) {
  try {
    player.runCommand("stopsound @s listener.floorboards");
  } catch (error) {}
}

function anyListener() {
  try {
    return world.getDimension("overworld").getEntities({ type: ID }).length > 0;
  } catch (error) {
    return false;
  }
}

function floorBusy(now) {
  const players = world.getPlayers();
  for (let i = 0; i < players.length; i++) {
    const player = players[i];
    if (player.getDynamicProperty("listener:floor_on") === 1) return true;
    if (now < num(player, "listener:quiet_until")) return true;
  }
  return false;
}

function spawnDuringSong(player, now) {
  if (!isOverworld(player)) return;
  const mode = String(player.getGameMode());
  if (mode === "spectator") return;
  if (anyListener()) return;
  let dim;
  try {
    dim = player.dimension;
  } catch (error) {
    return;
  }
  let spot = findSpawnSpot(player, true);
  if (!spot) spot = findSpawnSpot(player, false);
  if (!spot) spot = behindPlayer(player);
  if (!spot) return;
  try {
    const entity = dim.spawnEntity(ID, spot);
    entity.setDynamicProperty("listener:state", "stalk");
    entity.setDynamicProperty("listener:sx", spot.x);
    entity.setDynamicProperty("listener:sy", spot.y);
    entity.setDynamicProperty("listener:sz", spot.z);
    entity.setDynamicProperty("listener:tp_at", now + 200);
    entity.setDynamicProperty("listener:from_song", 1);
  } catch (error) {}
}

function tickFloorboards(now) {
  const players = world.getPlayers();
  for (let i = 0; i < players.length; i++) {
    const player = players[i];
    if (player.getDynamicProperty("listener:floor_on") === 1) {
      if (now >= num(player, "listener:floor_at")) {
        player.setDynamicProperty("listener:floor_on", 0);
        player.setDynamicProperty("listener:floor_at", now + 300);
        continue;
      }
      const elapsed = now - num(player, "listener:song_start");
      if (player.getDynamicProperty("listener:song_rolled") !== 1 && elapsed >= 400 && elapsed <= 600) {
        player.setDynamicProperty("listener:song_rolled", 1);
        if (Math.random() < 0.4) spawnDuringSong(player, now);
      }
      if (now < num(player, "listener:floor_check")) continue;
      player.setDynamicProperty("listener:floor_check", now + 40);
      if (!isNight() || !floorPlace(player)) {
        cutFloor(player);
        player.setDynamicProperty("listener:floor_on", 0);
        player.setDynamicProperty("listener:floor_at", now + 200);
      }
      continue;
    }
    if (num(player, "listener:floor_at") === 0) {
      player.setDynamicProperty("listener:floor_at", now + 100);
      continue;
    }
    if (now < num(player, "listener:floor_at")) continue;
    if (!isOverworld(player) || !isNight()) {
      player.setDynamicProperty("listener:floor_at", now + 80);
      continue;
    }
    if (!floorPlace(player)) {
      player.setDynamicProperty("listener:floor_at", now + 80);
      continue;
    }
    try {
      player.playSound("listener.floorboards", { volume: 0.85, pitch: 1 });
    } catch (error) {}
    player.setDynamicProperty("listener:floor_on", 1);
    player.setDynamicProperty("listener:song_start", now);
    player.setDynamicProperty("listener:song_rolled", 0);
    player.setDynamicProperty("listener:floor_at", now + 1340);
  }
}

function tickMusic(now) {
  const players = world.getPlayers();
  for (let i = 0; i < players.length; i++) {
    const player = players[i];
    const near = nearestListener(player);
    if (!near || near.dist > 42) continue;
    if (now < num(player, "listener:music_at")) continue;
    let sound = "listener.drone.far";
    let volume = 0.22;
    if (near.dist < 12) {
      sound = "listener.drone.close";
      volume = 0.7;
    } else if (near.dist < 26) {
      sound = "listener.drone.near";
      volume = 0.44;
    }
    try {
      player.playSound(sound, { volume: volume, pitch: 1 });
    } catch (error) {}
    player.setDynamicProperty("listener:music_at", now + 140);
  }
}

function allListeners() {
  const names = ["overworld", "nether", "the_end"];
  const out = [];
  for (let i = 0; i < names.length; i++) {
    try {
      const dim = world.getDimension(names[i]);
      const list = dim.getEntities({ type: ID });
      for (let j = 0; j < list.length; j++) out.push(list[j]);
    } catch (error) {}
  }
  return out;
}

function trySpawn(now) {
  if (floorBusy(now)) return;
  let dim;
  try {
    dim = world.getDimension("overworld");
  } catch (error) {
    return;
  }
  try {
    if (dim.getEntities({ type: ID }).length > 0) return;
  } catch (error) {
    return;
  }
  const ready = [];
  const players = world.getPlayers();
  for (let i = 0; i < players.length; i++) {
    const player = players[i];
    if (!isOverworld(player)) continue;
    const mode = String(player.getGameMode());
    if (mode !== "survival" && mode !== "adventure") continue;
    if (num(player, "listener:presence") < PRESENCE_GOAL) continue;
    ready.push(player);
  }
  if (ready.length === 0) return;
  const player = ready[Math.floor(Math.random() * ready.length)];
  const night = isNight();
  const covered = isCovered(player.dimension, player.location.x, player.location.y, player.location.z);
  let cave = false;
  if (night) {
    if (Math.random() > 0.2) return;
    cave = covered || Math.random() < 0.5;
  } else if (covered) {
    if (Math.random() > 0.06) return;
    cave = true;
  } else if (Math.random() < 0.04) {
    cave = true;
  } else if (Math.random() < 0.012) {
    cave = false;
  } else {
    return;
  }
  let spot = findSpawnSpot(player, cave);
  if (!spot && night) spot = findSpawnSpot(player, !cave);
  if (!spot) return;
  try {
    const entity = dim.spawnEntity(ID, spot);
    entity.setDynamicProperty("listener:state", "stalk");
    entity.setDynamicProperty("listener:sx", spot.x);
    entity.setDynamicProperty("listener:sy", spot.y);
    entity.setDynamicProperty("listener:sz", spot.z);
    entity.setDynamicProperty("listener:tp_at", now + 200);
  } catch (error) {}
}

world.afterEvents.itemUse.subscribe(function (event) {
  try {
    if (!event.itemStack || event.itemStack.typeId !== PAGE) return;
    showPage(event.source);
  } catch (error) {
    warn(error);
  }
});

world.afterEvents.entityHurt.subscribe(function (event) {
  try {
    const victim = event.hurtEntity;
    const source = event.damageSource ? event.damageSource.damagingEntity : undefined;
    if (victim && victim.typeId === "minecraft:player" && source && source.typeId === ID) {
      if (num(source, "listener:striking") === 1) return;
      const now = system.currentTick;
      source.setDynamicProperty("listener:retreat_until", now + 70);
      setState(source, "retreat");
      return;
    }
    if (!victim || victim.typeId !== ID) return;
    const now = system.currentTick;
    if (now < num(victim, "listener:flee_until")) return;
    victim.setDynamicProperty("listener:flee_until", now + 160);
    victim.setDynamicProperty("listener:calm_until", now + 40);
    const away = findFleeSpot(victim);
    if (away) {
      try {
        victim.teleport(away, { keepVelocity: false });
        victim.dimension.playSound("listener.teleport", away, { volume: 0.36, pitch: 0.68 });
      } catch (error) {}
    }
    setState(victim, "stalk");
  } catch (error) {
    warn(error);
  }
});

world.afterEvents.entityDie.subscribe(function (event) {
  try {
    const dead = event.deadEntity;
    if (!dead || dead.typeId !== ID) return;
    const loc = dead.location;
    const players = world.getPlayers();
    for (let i = 0; i < players.length; i++) {
      if (dist3(players[i].location, loc) > 40) continue;
      players[i].sendMessage({ translate: "chat.listener.death" });
      players[i].playSound("listener.sting", { volume: 0.38, pitch: 0.64 });
    }
  } catch (error) {}
});

let spawnAcc = 0;
system.runInterval(function () {
  let now = 0;
  try {
    now = system.currentTick;
  } catch (error) {
    return;
  }
  try {
    tickPresence(now);
  } catch (error) {
    warn(error);
  }
  try {
    const list = allListeners();
    for (let i = 0; i < list.length; i++) tickEntity(list[i], now);
  } catch (error) {
    warn(error);
  }
  try {
    tickMusic(now);
  } catch (error) {
    warn(error);
  }
  try {
    tickFloorboards(now);
  } catch (error) {
    warn(error);
  }
  spawnAcc += 10;
  if (spawnAcc >= SPAWN_PERIOD) {
    spawnAcc = 0;
    try {
      trySpawn(now);
    } catch (error) {
      warn(error);
    }
  }
}, 10);

system.runInterval(function () {
  let now = 0;
  try {
    now = system.currentTick;
  } catch (error) {
    return;
  }
  try {
    const list = allListeners();
    for (let i = 0; i < list.length; i++) chaseTick(list[i], now);
  } catch (error) {
    warn(error);
  }
}, 1);
