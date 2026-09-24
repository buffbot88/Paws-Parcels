import Phaser from "phaser";
import { TILE_SIZE } from "../game/GameConfig.ts";
import { OBJECT_MARKER_SIZE_PX, SceneKeys, TextureKeys, ZoneKeys } from "../game/GameConstants.ts";
import { PLAYABLE_MAPS, type MapData, type MapInteractable, type MapPoint } from "../game/Maps.ts";
import { COLLIDING_TILE_INDICES, TILE_INDEX } from "../game/Tiles.ts";
import { InputSystem } from "../systems/InputSystem.ts";
import { NetworkSystem } from "../systems/NetworkSystem.ts";
import {
  pickCharacter,
  readBootCharacters,
  readSelectedCharacterId,
  resolveBootTarget,
} from "../net/bootTarget.ts";
import { classCooldownMs } from "../game/classStats.ts";
import { hasAdminDevAccess, readAuthToken } from "../ui/LoginOverlay.ts";
import { ChatBox } from "../ui/ChatBox.ts";
import { toasts } from "../ui/ToastStack.ts";
import { apiPath } from "../config.ts";
import { Player } from "../entities/Player.ts";
import { NPC } from "../entities/NPC.ts";
import { InteractionSystem, type InteractionTarget } from "../systems/InteractionSystem.ts";
import { sanitizeSpawn } from "../systems/MapValidator.ts";
import { selectDialogueSet } from "../systems/DialogueService.ts";
import { DialoguePanel } from "../ui/DialoguePanel.ts";
import { Minimap } from "../ui/Minimap.ts";
import { SkillBar } from "../ui/SkillBar.ts";
import { CharacterProfilePanel } from "../ui/CharacterProfilePanel.ts";
import { QuestTracker } from "../ui/QuestTracker.ts";
import { QuestCompass } from "../ui/QuestCompass.ts";
import {
  compassDistanceTiles,
  compassLabel,
  groundCompassAngle,
  questDestination,
  shouldShowCompass,
  tileCentre,
  type CompassDestination,
} from "../ui/hud/questCompass.ts";
import { npcQuestMarker } from "../ui/hud/questMarkers.ts";
import { InventoryButton } from "../ui/InventoryButton.ts";
import { LocalMapPanel } from "../ui/LocalMapPanel.ts";
import { addCloverVillageSetPieces } from "../game/cloverVillageAssets.ts";
import { addHappyValleySetPieces } from "../game/happyValleyAssets.ts";
import {
  CLOVER_VILLAGE_TERRAIN,
  getCloverVillageSetPieceDefinitions,
} from "../game/cloverVillagePlacements.ts";
import {
  HAPPY_VALLEY_TERRAIN,
  getHappyValleySetPieceDefinitions,
} from "../game/happyValleyPlacements.ts";
import { addTerrainSurface, terrainPlanInput, type TerrainMaterials } from "../game/terrainAssets.ts";
import {
  CAMERA_FRAMING,
  framedFollowOffset,
  framingForMotionPreference,
  type CameraFraming,
  type OffsetPx,
} from "../game/cameraFraming.ts";
import { reservedTilesFor, COMPOSITION_DEFAULTS } from "../game/terrainComposition.ts";
import { buildTerrainPlan, type TerrainPlan } from "../game/terrainSurface.ts";
import { entityNameTagOffsetPx, entityShadow, villagerSizing } from "../game/entitySizing.ts";
import { npcArtForDefinition } from "../game/cloverVillageNpcAssets.ts";
import {
  CLOVER_VILLAGE_PROP_SIZING,
  HAPPY_VALLEY_PROP_SIZING,
} from "../game/propSizing.ts";
import { COMPOSITION_BY_ZONE } from "../game/compositionPlans.ts";
import type { VisualSceneMetadata } from "../types/VisualSceneMetadata.ts";
import npcsJson from "../data/npcs.json" with { type: "json" };
import dialogueJson from "../data/dialogue.json" with { type: "json" };
import questsJson from "../data/quests.json" with { type: "json" };
import type { NPC as NPCDefinition } from "../types/NPCtypes.ts";
import type { DialogueSet } from "../types/DialogueTypes.ts";
import type { QuestDefinition } from "../types/QuestTypes.ts";
import { DEPTH_OFFSET, worldDepth } from "../game/WorldDepth.ts";
import { WorldRenderer3D } from "../render3d/WorldRenderer3D.ts";
import { CAMERA_3D, groundForeshortening } from "../render3d/camera3d.ts";
import { entityBillboards } from "../render3d/entityView.ts";
import { readRendererMode, type RendererMode } from "../render3d/rendererMode.ts";

export interface OverworldSceneData {
  zoneId?: string;
  spawn?: MapPoint;
  /** Shown in the quest tracker once the restarted scene is up. */
  notice?: string;
}

const NPCS = npcsJson.npcs as NPCDefinition[];
const DIALOGUE = dialogueJson.dialogue as DialogueSet[];
const QUESTS = questsJson.quests as QuestDefinition[];
/** One DOM panel for the whole app — scenes come and go, the overlay persists. */
export const dialoguePanel = new DialoguePanel();
/** Client-side attack-pickup radius (tiles); the server enforces the real range. */
const ATTACK_TARGET_RANGE = 6;

/**
 * The interaction badge, in px at 48px tiles: the small "E" (or "Tap" on
 * touch) that hangs over the head of the one thing this courier is focused on.
 *
 * Deliberately tiny. It annotates a villager; it does not announce them. The
 * 230x34 cream card this replaced said the same thing while covering the NPC
 * and the plaza around it, and it followed the *player* rather than the NPC, so
 * it read as a banner floating in the middle of the world.
 */
const PROMPT_BADGE_HEIGHT_PX = 22;
/** Clearance between the badge and whatever art is already drawn there. */
const PROMPT_BADGE_GAP_PX = 6;
/** A villager name tag: 11-12px text plus 3px padding, see NPC.ts. */
const NPC_NAME_TAG_HEIGHT_PX = 20;

/**
 * Where the badge hangs for a target whose own annotation — a villager's name
 * tag, an object marker — is centred `artCentrePx` above the tile centre and
 * `artHeightPx` tall. Negative means above. The badge sits over that art rather
 * than on it, because both annotate the same spot.
 */
function promptOffsetAbove(artCentrePx: number, artHeightPx: number): number {
  return artCentrePx - artHeightPx / 2 - PROMPT_BADGE_GAP_PX - PROMPT_BADGE_HEIGHT_PX / 2;
}

/** Min ms between AI NPC line requests (server also rate-limits). */
const NPC_TALK_MIN_INTERVAL_MS = 1_200;
/** Min ms between scene snapshots sent to the model (1-core protection). */
const SCENE_SNAPSHOT_MIN_INTERVAL_MS = 8_000;
/** Scene snapshot max width before downscaling (keeps VL calls cheap). */
const SCENE_SNAPSHOT_MAX_WIDTH = 320;
/** Capture uploads are downscaled to stay below the server's bounded PNG/body limits. */
const VISUAL_CAPTURE_MAX_WIDTH = 800;
/** Leave headroom below the server's 1.5 MB decoded PNG limit. */
const VISUAL_CAPTURE_MAX_BYTES = 1_400_000;
/**
 * World camera zoom (visual Pass 1 — camera framing).
 *
 * The previous Clover Village value was 0.8: a zoom *out*, despite the comment
 * describing a zoom-in. It shrank the courier and pushed ~25 tiles across the
 * viewport, which is a large part of why the world read as a flat tile field
 * seen from far away. A modest zoom-in frames the village at reference scale
 * (~18 tiles wide), so buildings, props and the courier occupy comparable
 * screen space instead of the world drifting off into the distance.
 *
 * Interplay warning: scripts/downscale-clover-valley-props.mjs sized every
 * prop texture against a 0.8 camera ("4x its largest rendered size"). Zooming
 * in only increases a prop's on-screen size, so that rule stays satisfied.
 * Do NOT re-run that script to "correct" for this — it rewrites the hand-tuned
 * `scale:` values inside cloverVillagePlacements.ts in place.
 */
const WORLD_CAMERA_ZOOM = 1.1;

/**
 * Terrain materials per zone, for the shared `addTerrainSurface` renderer.
 *
 * A zone absent from this table keeps the procedural tile art it always had,
 * so adding a map here is the only opt-in the renderer needs.
 */
const TERRAIN_BY_ZONE: Readonly<Record<string, TerrainMaterials>> = {
  [ZoneKeys.CloverVillage]: CLOVER_VILLAGE_TERRAIN,
  [ZoneKeys.HappyValley]: HAPPY_VALLEY_TERRAIN,
};

/**
 * Composition plans come from `src/game/compositionPlans.ts`, which reads the
 * authored JSON (`src/data/maps/*.composition.json`) so a zone's clearings and
 * thickets are content a designer can edit without touching a system. A zone
 * with no plan composes exactly as every zone did before plans existed, and
 * `npm run validate` rejects a plan that no longer matches its map.
 */

/**
 * The zone-capable world scene (Phase 2-3): builds a tilemap from the custom
 * JSON maps, collides the player, follows with a clamped camera, restarts on
 * transition tiles, and exposes NPCs + objects with tap/E-Space interaction
 * and a DOM dialogue overlay.
 */
export class OverworldScene extends Phaser.Scene {
  private player!: Player;
  private shadow!: Phaser.GameObjects.Ellipse;
  /** The zone's terrain plan, built once per create() for the tilemap + surface. */
  private terrainPlan: TerrainPlan | null = null;
  private lastNpcTalkAt = 0;
  private lastSceneSnapshotAt = 0;
  private captureInProgress = false;
  private inputSystem!: InputSystem;
  private interactionSystem!: InteractionSystem;
  private mapData!: MapData;
  private groundLayer!: Phaser.Tilemaps.TilemapLayer;
  private prompt!: Phaser.GameObjects.Container;
  /** Which target the badge is currently anchored to (null = hidden). */
  private promptTargetId: string | null = null;
  private minimap!: Minimap;
  private skillBar!: SkillBar;
  private chatBox!: ChatBox;
  private questTracker!: QuestTracker;
  private questCompass!: QuestCompass;
  /** The active quest's destination this frame, mirrored into the minimap. */
  private questDestination: CompassDestination | null = null;
  private inventoryButton!: InventoryButton;
  private localMap!: LocalMapPanel;
  private lastTileX = -1;
  private lastTileY = -1;
  /** The 3D world renderer, when this session runs one. */
  private world3d: WorldRenderer3D | null = null;
  /** Which world renderer this session runs (3D is the shipped default). */
  private readonly renderMode: RendererMode = readRendererMode();
  /** Where the 3D badge hangs, or null when nothing is focused. */
  private badge3d: { x: number; y: number; z: number } | null = null;
  /** Last size the WebGL canvas was fitted to, so resize is a comparison. */
  private world3dSize = { width: 0, height: 0 };
  /** The framing rules in force (see cameraFraming.ts), resolved per session. */
  private cameraFraming: CameraFraming = CAMERA_FRAMING;
  /** The look-ahead the camera is currently carrying, in world px. */
  private cameraLookAhead: OffsetPx = { x: 0, y: 0 };
  private isTransitioning = false;
  private isDefeated = false;
  private network = NetworkSystem.get();
  private visualNpcs: NPC[] = [];
  private visualGround: Phaser.GameObjects.GameObject[] = [];
  private visualSetPieces: Phaser.GameObjects.Image[] = [];
  private visualSetPieceShadows: Phaser.GameObjects.Ellipse[] = [];
  private visualInteractables: MapInteractable[] = [];

  constructor() {
    super(SceneKeys.Overworld);
  }

  create(data?: OverworldSceneData): void {
    this.isTransitioning = false;
    this.isDefeated = false;
    this.visualNpcs = [];
    this.visualGround = [];
    this.visualSetPieces = [];
    this.visualSetPieceShadows = [];
    this.visualInteractables = [];

    // Boot where the courier actually is (their server-saved zone + position)
    // unless a scene restart already decided the zone. The authenticated
    // session's zone wins over the character-list snapshot (which can be stale
    // if another tab moved the courier). Unknown saved zones fall back to the
    // hub — never leave the scene half-built.
    const boot = resolveBootTarget(readBootCharacters());
    const requestedZone =
      data?.zoneId ?? this.network.getAuthoritativeZone() ?? boot.zoneId;
    const map = PLAYABLE_MAPS[requestedZone];
    if (!map) {
      this.add
        .text(this.scale.width / 2, this.scale.height / 2, "Maps are offline while the new world is being built.", {
          fontFamily: "Georgia, serif",
          fontSize: "20px",
          color: "#3a5a3a",
          align: "center",
          wordWrap: { width: this.scale.width - 48 },
        })
        .setOrigin(0.5);
      return;
    }
    const zoneId = requestedZone;
    const resolved = map;
    this.mapData = resolved;
    const character = pickCharacter(
      readBootCharacters(),
      readSelectedCharacterId(),
    );

    // Begin the authoritative session as soon as the zone is known. This is
    // intentionally before tilemap/art/UI construction: a broken optional
    // visual layer must not prevent ws-token acquisition or same-zone presence.
    this.network.attach(this, zoneId);
    if (character !== null) this.network.start(zoneId, character.id);

    // One shared authored-surface renderer for every zone. A zone that supplies
    // no materials (anything but the two hand-composed maps) simply keeps its
    // procedural tile art, and the call is still cleanup-safe.
    const terrain = TERRAIN_BY_ZONE[resolved.id];
    // The terrain plan is pure and cheap, and two passes need the same answer:
    // the tilemap asks which blocking tiles have art over them, and the surface
    // renderer draws exactly that plan.
    const reserved = reservedTilesFor(
      resolved,
      NPCS.filter((npc) => npc.homeZone === resolved.id).map((npc) => npc.homeTile),
    );
    this.terrainPlan =
      terrain === undefined
        ? null
        : buildTerrainPlan(
            resolved,
            terrainPlanInput(terrain, {
              reserved,
              composition: COMPOSITION_BY_ZONE[resolved.id] ?? COMPOSITION_DEFAULTS,
              sizing:
                resolved.id === ZoneKeys.CloverVillage
                  ? CLOVER_VILLAGE_PROP_SIZING
                  : HAPPY_VALLEY_PROP_SIZING,
            }),
          );
    this.buildTilemap(resolved);
    if (terrain !== undefined) {
      // Hand the composition planner the tiles decoration must keep clear of:
      // the map's own spawn/transitions/interactables plus this zone's NPCs.
      this.visualGround = addTerrainSurface(this, resolved, terrain, {
        reserved,
        plan: this.terrainPlan ?? undefined,
      });
    }
    // Physics world matches the whole map so the camera + colliders behave.
    this.physics.world.setBounds(
      0,
      0,
      resolved.width * TILE_SIZE,
      resolved.height * TILE_SIZE,
    );

    // Explicit transition spawn wins. For a true fresh boot (no scene data)
    // use the courier's saved position; for a restart that omitted a spawn,
    // use the map's default spawn — never the courier's old position from
    // another zone. sanitizeSpawn then guards against stale/corrupt data
    // landing the courier out of bounds or inside a wall.
    const spawn = sanitizeSpawn(
      resolved,
      data?.spawn ?? (data ? resolved.spawn : boot.pos),
    );
    this.player = new Player(
      this,
      spawn.x * TILE_SIZE + TILE_SIZE / 2,
      spawn.y * TILE_SIZE + TILE_SIZE / 2,
      character?.class_id ?? 1,
    );
    // The courier's own name over their head, from the same session character
    // the status card and the top bar use — so it can never disagree with them.
    this.player.setDisplayName(character?.name ?? "Courier");
    // The courier's shadow comes from the same recipe as every prop's (Pass 6),
    // sized from its own ground contact, and sits at the figure's feet as the
    // entity convention measures them — not at a fixed 12px below centre.
    const playerShadow = entityShadow(this.player.sizing);
    this.shadow = this.add
      .ellipse(
        this.player.x,
        this.player.y + this.player.feetOffsetPx,
        playerShadow.widthPx,
        playerShadow.heightPx,
        playerShadow.color,
        playerShadow.alpha,
      )
      .setDepth(worldDepth(this.player.y, DEPTH_OFFSET.contactShadow));
    this.player.setDepth(worldDepth(this.player.y));

    // Collide with the ground layer only now that the player exists (and guard
    // in case buildTilemap bailed, so we never pass undefined to the collider).
    if (this.groundLayer) {
      this.physics.add.collider(this.player, this.groundLayer);
    }

    this.buildNpcs(resolved);
    if (resolved.id === ZoneKeys.CloverVillage) {
      this.visualSetPieces = addCloverVillageSetPieces(this);
      this.visualSetPieceShadows = this.visualSetPieces
        .map((piece) => piece.getData("cloverVillageShadow"))
        .filter((shadow): shadow is Phaser.GameObjects.Ellipse => shadow instanceof Phaser.GameObjects.Ellipse);
    } else if (resolved.id === ZoneKeys.HappyValley) {
      this.visualSetPieces = addHappyValleySetPieces(this);
      this.visualSetPieceShadows = this.visualSetPieces
        .map((piece) => piece.getData("happyValleyShadow"))
        .filter((shadow): shadow is Phaser.GameObjects.Ellipse => shadow instanceof Phaser.GameObjects.Ellipse);
    }
    this.visualInteractables = resolved.interactables;
    this.buildObjectMarkers(resolved);
    this.buildInteractionSystem(resolved);

    const camera = this.cameras.main;
    camera.setBounds(0, 0, resolved.width * TILE_SIZE, resolved.height * TILE_SIZE);
    // Frame the world at reference scale. Every zone shares one zoom so the
    // courier keeps a constant apparent size across the village and the
    // valley; tile scale, collision, and camera bounds are all unchanged.
    camera.setZoom(WORLD_CAMERA_ZOOM);
    // Keep fractional camera positions for smooth 2.5D art; integer camera
    // rounding would make movement look like pixel-art stepping.
    camera.startFollow(this.player, false, 0.12, 0.12);
    // Pass 1 settled the camera's scale; this settles where the courier sits in
    // the frame. `startFollow` alone centres them exactly, which gives the
    // ground already walked as much of the viewport as the world ahead of them
    // (see `cameraFraming.ts`). Applied here as well as per frame so the very
    // first rendered frame is already framed.
    const reducedMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches === true;
    this.cameraFraming = framingForMotionPreference(CAMERA_FRAMING, reducedMotion);
    this.cameraLookAhead = { x: 0, y: 0 };
    this.updateCameraFraming({ x: 0, y: 0 });

    this.addUi();
    this.buildQuickMenu();
    this.localMap = new LocalMapPanel();
    this.localMap.attach(resolved);
    this.buildPrompt();
    // The world itself is drawn in 3D from here on: Phaser keeps owning input,
    // entities, collision and the HUD, while the frame comes from the WebGL
    // canvas under the HUD layers. The sprite renderer stays reachable through
    // `?renderer=2d` so a regression can be compared against it.
    this.buildWorld3D(resolved, terrain);

    // Phase 4 — world minimap: pre-renders this zone's terrain once and
    // tracks the courier + network entities live each frame.
    this.minimap = new Minimap();
    this.minimap.attach(resolved, NPCS);
    this.skillBar = new SkillBar(() => this.requestBasicAttack());
    this.chatBox = new ChatBox((text) => this.network.chat(text));
    this.questTracker = new QuestTracker((questId) => this.network.acceptQuest(questId));
    this.questCompass = new QuestCompass();
    this.inventoryButton = new InventoryButton(() => this.openInventory());
    this.network.onQuestState = (quests) => this.questTracker.setQuests(quests);
    this.network.onNpcInteraction = (npcId, quests) => {
      this.questTracker.setQuests(quests);
      const offer = quests.find((quest) => quest.giverId === npcId && quest.state === "available");
      this.questTracker.setOffer(offer?.questId ?? null);
    };
    this.network.onQuestUpdated = (payload) => {
      this.questTracker.setQuests(payload.quests);
      this.questTracker.setOffer(null);
      this.questTracker.showMessage(payload.message);
      if (payload.action === "accepted" || payload.action === "delivery") {
        this.showQuestMilestoneDialogue(payload.quest.questId, payload.action);
      }
      CharacterProfilePanel.instance?.refresh();
    };
    this.network.onQuestNotice = (message) => this.questTracker.showMessage(message);
    // Gameplay rejections (quest/inventory/chat/zone) are toasted by NetworkSystem;
    // the open ledger also replaces its pending status with the reason.
    this.network.onGameplayNotice = (message) => {
      CharacterProfilePanel.instance?.showNotice(message);
    };
    if (data?.notice !== undefined) toasts.show(data.notice, "warning");
    this.network.onStatus = (status, detail) => {
      this.minimap.setServerStatus(status, detail);
      this.chatBox.setEnabled(status === "joined");
      if (status === "joined") {
        document.querySelector(".connection-diagnostic")?.remove();
      }
    };
    const currentStatus = this.network.getStatus();
    this.minimap.setServerStatus(currentStatus.status, currentStatus.detail);
    this.chatBox.setEnabled(currentStatus.status === "joined");
    this.network.onChatMessage = (message) =>
      this.chatBox.addMessage({
        sender: message.name,
        text: message.text,
        self: message.characterId === this.network.getCharacterId(),
      });
    // The cooldown sweep should reflect how long the server will gate the
    // next attack (bear 3s / cat 2.5s / fox 2s), not a fixed cosmetic flash.
    this.network.onAttackConfirmed = () =>
      this.skillBar.showFeedback(classCooldownMs(this.player.classKey));
    this.network.onLoot = () => {
      // The server has already committed loot to SQLite; refresh the open
      // sheet so inventory reflects the authoritative grant immediately.
      CharacterProfilePanel.instance?.refresh();
      // Loot sends no inventory snapshot; ask for one so hand-in counts and markers follow.
      this.network.requestInventory();
    };
    this.network.onInventoryUpdated = (items, _stamps, state) => {
      this.questTracker.setInventory(items);
      // Equip, unequip, move, and quest/loot grants all arrive as authoritative
      // snapshots. Keep the open courier ledger in sync with the server, and
      // let gear speed affect the rendered courier (the server already allows
      // the faster cadence — the sprite must keep up or the view desyncs).
      const speed = state?.stats?.speed;
      if (typeof speed === "number" && Number.isFinite(speed) && speed > 0) {
        this.player.setSpeed(speed);
      }
      CharacterProfilePanel.instance?.refresh();
    };

    // Remember the arrival tile so spawning on a transition never re-triggers.
    this.lastTileX = spawn.x;
    this.lastTileY = spawn.y;

    // The server is always authoritative for where this courier actually is.
    // Keep snapping to zone_state so a page refresh, defeat respawn, or any
    // scene restart with a spawn never lets the render diverge from the server.
    this.network.onSelfPosition = (tile) => this.placeAtTile(tile);
    const authoritativeTile = this.network.getSelfPosition();
    if (authoritativeTile !== null) this.placeAtTile(authoritativeTile);

    // The server authenticated this session into a different zone than this
    // scene (another tab moved the courier before this tab's join) — restart
    // the scene there. Only fires before the first zone_state, so an
    // established session never gets yanked around by reconnects.
    this.network.onServerZoneRedirect = (zoneId) => {
      if (zoneId === this.mapData.id) return;
      this.network.joinZone(zoneId);
      this.scene.restart({
        zoneId,
      } satisfies OverworldSceneData);
    };
    // The server refused this zone switch and kept the courier where it was —
    // go back there; zone_state then snaps the courier to its real tile.
    this.network.onZoneJoinRejected = (zoneId, message) => {
      this.network.joinZone(zoneId);
      this.scene.restart({ zoneId, notice: message } satisfies OverworldSceneData);
    };

    this.inputSystem = new InputSystem(this, { devAccess: hasAdminDevAccess() });

    // Phase 2-3 — multiplayer callbacks. The socket was started above so
    // optional scene decoration cannot block authentication or presence.
    // Defeat = respawn at the safe hub (server says where).
    this.network.onPlayerDefeated = () => {
      this.isDefeated = true;
      dialoguePanel.close();
      this.player.playDeath();
    };
    this.network.onDefeat = (info) => {
      this.isDefeated = false;
      if (info.zoneId === this.mapData.id) {
        // Same zone respawn — just move the courier + restore HP.
        this.player.setPosition(
          info.pos.x * TILE_SIZE + TILE_SIZE / 2,
          info.pos.y * TILE_SIZE + TILE_SIZE / 2,
        );
        this.player.playIdle();
      } else {
        this.network.joinZone(info.zoneId);
        this.scene.restart({
          zoneId: info.zoneId,
          spawn: info.pos,
        } satisfies OverworldSceneData);
      }
    };
    // Restarts emit SHUTDOWN; game.destroy() (courier switch) emits only
    // DESTROY. Both must release the DOM HUD, listeners and WebGL context once.
    let tornDown = false;
    const teardown = (): void => {
      if (tornDown) return;
      tornDown = true;
      this.events.off(Phaser.Scenes.Events.SHUTDOWN, teardown);
      this.events.off(Phaser.Scenes.Events.DESTROY, teardown);
      dialoguePanel.close();
      this.world3d?.destroy();
      this.world3d = null;
      for (const object of this.visualGround) object.destroy();
      for (const piece of this.visualSetPieces) piece.destroy();
      for (const shadow of this.visualSetPieceShadows) shadow.destroy();
      this.inputSystem.destroy();
      this.minimap.destroy();
      this.skillBar.destroy();
      this.chatBox.destroy();
      this.questTracker.destroy();
      this.questCompass.destroy();
      this.inventoryButton.destroy();
      this.localMap.destroy();
      this.network.detach(this);
    };
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, teardown);
    this.events.once(Phaser.Scenes.Events.DESTROY, teardown);
  }

  update(): void {
    // Defeat freeze: let the death pose remain visible until the server sends
    // the authoritative respawn payload.
    if (this.isDefeated) {
      this.updateCameraFraming({ x: 0, y: 0 });
      this.questCompass.update({
        origin: this.playerCanvasFraction(),
        label: "",
        angleRad: 0,
        visible: false,
      });
      this.player.move({ x: 0, y: 0 });
      this.player.setDepth(worldDepth(this.player.y));
      this.shadow.setPosition(this.player.x, this.player.y + this.player.feetOffsetPx);
      this.shadow.setDepth(worldDepth(this.player.y, DEPTH_OFFSET.contactShadow));
      this.skillBar.setVisible(false);
      this.inputSystem.discardQueued();
      this.updatePrompt(null);
      this.updateWorld3D({ x: 0, y: 0 });
      this.network.update();
      return;
    }

    // Dialogue open: freeze the world, feed E/Space into the panel only.
    if (dialoguePanel.isOpen()) {
      // The lead unwinds while the world is frozen, so closing a conversation
      // does not leave the camera pointing at a road nobody is walking.
      this.updateCameraFraming({ x: 0, y: 0 });
      this.player.move({ x: 0, y: 0 });
      this.player.setDepth(worldDepth(this.player.y));
      this.shadow.setPosition(this.player.x, this.player.y + this.player.feetOffsetPx);
      this.shadow.setDepth(worldDepth(this.player.y, DEPTH_OFFSET.contactShadow));
      this.skillBar.setVisible(false);
      if (this.inputSystem.consumeInteract()) dialoguePanel.advance();
      this.inputSystem.discardQueued();
      this.updatePrompt(null);
      this.updateWorld3D({ x: 0, y: 0 });
      return;
    }

    this.skillBar.setVisible(true);
    const vector = this.inputSystem.getMoveVector();
    this.player.move(vector);
    this.player.setDepth(worldDepth(this.player.y));
    this.shadow.setPosition(this.player.x, this.player.y + this.player.feetOffsetPx);
    this.shadow.setDepth(worldDepth(this.player.y, DEPTH_OFFSET.contactShadow));
    // Lead the direction of travel a little, so the road ahead is revealed
    // before the courier reaches it.
    this.updateCameraFraming(vector);

    // Phase 2 — send a throttled move intent (dominant axis only; the server
    // rejects diagonals) and interpolate other couriers' snapshots.
    if (Math.abs(vector.x) >= Math.abs(vector.y)) {
      this.network.moveIntent(Math.sign(vector.x), 0);
    } else {
      this.network.moveIntent(0, Math.sign(vector.y));
    }

    // Inventory: I opens the same server-backed profile panel as the HUD
    // button; InputSystem only queues the shortcut and does not own the UI.
    if (this.inputSystem.consumeInventory()) {
      this.openInventory();
    }

    // Phase 3 — attack: 1 targets the nearest monster in class range (the
    // server re-validates range + cooldown and rejects anything untrustworthy).
    if (this.inputSystem.consumeAttack()) {
      this.requestBasicAttack();
    }

    this.network.update();

    if (this.inputSystem.consumeCapture() && !this.captureInProgress) {
      this.captureInProgress = true;
      void this.captureVisualReview().finally(() => {
        this.captureInProgress = false;
      });
    }

    // Phase 4 — minimap live layer (own courier, others, monsters, and the
    // active quest's destination).
    this.updateQuestGuide();
    this.minimap.update({
      player: {
        x: this.player.x / TILE_SIZE,
        y: this.player.y / TILE_SIZE,
      },
      players: this.network.getRemotePositions(),
      monsters: this.network.getMonsterPositions(),
      quest: this.questDestination === null ? null : this.questDestination.tile,
    });

    const focused = this.interactionSystem.getFocused(
      this.player.x,
      this.player.y,
      TILE_SIZE,
    );
    this.updatePrompt(focused);

    const tap = this.inputSystem.consumeTap();
    const interacted =
      (tap && this.tapHits(tap.worldX, tap.worldY, focused)) ||
      this.inputSystem.consumeInteract();

    if (interacted && focused) {
      this.startInteraction(focused);
    }

    this.checkTransition();
    this.updateWorld3D(vector);
  }

  /**
   * Build the 3D world for this zone and hand the frame over to it.
   *
   * A zone with no authored terrain keeps the sprite renderer: the 3D world is
   * built from the terrain plan and the placement tables, and without them there
   * is nothing to stand up in three dimensions.
   */
  private buildWorld3D(map: MapData, terrain: TerrainMaterials | undefined): void {
    if (this.renderMode !== "3d" || terrain === undefined || this.terrainPlan === null) return;
    const host = document.getElementById("game-container");
    if (host === null) return;
    try {
      const world = new WorldRenderer3D(this.sys.textures, host);
      world.attachZone({
        map,
        materials: terrain,
        plan: this.terrainPlan,
        placements:
          map.id === ZoneKeys.CloverVillage
            ? getCloverVillageSetPieceDefinitions()
            : getHappyValleySetPieceDefinitions(),
        sizing:
          map.id === ZoneKeys.CloverVillage
            ? CLOVER_VILLAGE_PROP_SIZING
            : HAPPY_VALLEY_PROP_SIZING,
      });
      this.world3d = world;
      // The sprite world is no longer the frame: entities keep updating, and
      // only the drawing of them moves to the WebGL canvas.
      this.cameras.main.setVisible(false);
      this.world3dSize = { width: host.clientWidth, height: host.clientHeight };
    } catch (error) {
      // A context that cannot open WebGL is a rendering failure, never a
      // gameplay one: fall back to the sprite world and say so.
      console.error("OverworldScene: 3D world unavailable, keeping the sprite renderer", error);
      this.world3d = null;
    }
  }

  /** Hand this frame's world state to the 3D renderer. */
  private updateWorld3D(direction: OffsetPx): void {
    const world = this.world3d;
    if (world === null) return;
    const host = document.getElementById("game-container");
    if (host !== null) {
      const width = host.clientWidth;
      const height = host.clientHeight;
      if (width !== this.world3dSize.width || height !== this.world3dSize.height) {
        this.world3dSize = { width, height };
        world.resize();
      }
    }
    world.frame({
      subject: { x: this.player.x / TILE_SIZE, z: this.player.y / TILE_SIZE },
      direction,
      dtSeconds: this.game.loop.delta / 1000,
      framing: this.cameraFraming,
      entities: entityBillboards(this.children.list),
      badge: this.badge3d,
      badgeTouch: this.sys.game.device.input.touch,
    });
  }

  /**
   * Aim the quest guidance: villager quest markers, the arrow ahead of the
   * courier, and the minimap's destination marker.
   *
   * Both read the same resolved destination, so the arrow and the map can never
   * disagree about where the quest wants the courier to go. Rendering only:
   * nothing here is sent to the server, and nothing moves but HUD elements.
   */
  private updateQuestGuide(): void {
    const quests = this.questTracker.getQuests();
    const inventory = this.questTracker.getInventory();
    for (const npc of this.visualNpcs) npc.setQuestMarker(npcQuestMarker(npc.definition.id, quests, inventory));
    const guide = questDestination({
      active: this.questTracker.getActiveQuest() ?? null,
      // With nothing in progress the compass still guides — to whoever hands
      // out the next leg of the chain, which is the whole point for a courier
      // who has just arrived and has no quest yet.
      quests,
      zoneId: this.mapData.id,
      npcs: NPCS,
      objects: this.mapData.interactables,
      from: { x: this.player.x / TILE_SIZE, y: this.player.y / TILE_SIZE },
      maps: Object.values(PLAYABLE_MAPS),
    });
    this.questDestination = guide === null ? null : guide.destination;

    const destination = this.questDestination;
    const player = { x: this.player.x / TILE_SIZE, y: this.player.y / TILE_SIZE };
    if (destination === null) {
      this.questCompass.update({
        origin: this.playerCanvasFraction(),
        label: "",
        angleRad: 0,
        visible: false,
      });
      return;
    }

    // Authored content names tiles by index; the courier's position is
    // continuous tile units. Measure centre-to-position, or the arrow is half a
    // tile off and the label reads one tile long.
    const target = tileCentre(destination.tile);
    const distance = compassDistanceTiles(player, target);
    this.questCompass.update({
      origin: this.playerCanvasFraction(),
      angleRad: groundCompassAngle(
        target.x - player.x,
        target.y - player.y,
        this.renderForeshortening(),
      ),
      label: compassLabel(destination, distance),
      // Close enough to see them: the arrow would sit on top of the villager it
      // is pointing at, which is worse than no guidance at all.
      visible: shouldShowCompass(distance),
    });
  }

  /**
   * Where the courier is on screen, as a fraction of the play area (0–1).
   *
   * Asked of whichever renderer is drawing the frame: the 3D camera projects the
   * ground point, and the sprite camera's visible world rectangle is the same
   * measurement for the 2D path. Fractions (not pixels) are what lets one HUD
   * element sit correctly on both, and at every window scale.
   */
  private playerCanvasFraction(): { x: number; y: number } {
    const world = this.world3d;
    if (world !== null) {
      return world.projectGround(this.player.x / TILE_SIZE, this.player.y / TILE_SIZE);
    }
    const view = this.cameras.main.worldView;
    if (view.width <= 0 || view.height <= 0) return { x: 0.5, y: 0.5 };
    return {
      x: (this.player.x - view.x) / view.width,
      y: (this.player.y - view.y) / view.height,
    };
  }

  /**
   * How much the frame compresses the north/south axis — 1 in the top-down
   * sprite world, `sin(pitch)` under the 3/4 3D camera. Shared with the camera
   * module so the arrow aims along the direction the frame actually draws.
   */
  private renderForeshortening(): number {
    return this.world3d === null ? 1 : groundForeshortening(CAMERA_3D);
  }

  /**
   * Place the camera's focus for this frame (see `cameraFraming.ts`).
   *
   * Rendering only: the offset moves the camera, never the courier, and the
   * server's idea of where the courier is never changes. The frame delta comes
   * from the game loop so the easing is the same at any frame rate.
   */
  private updateCameraFraming(direction: OffsetPx): void {
    const camera = this.cameras.main;
    const framed = framedFollowOffset(
      this.cameraFraming,
      { heightPx: camera.height, zoom: camera.zoom },
      direction,
      this.cameraLookAhead,
      TILE_SIZE,
      this.game.loop.delta / 1000,
    );
    this.cameraLookAhead = framed.lookAhead;
    camera.setFollowOffset(framed.x, framed.y);
  }

  /** Open the courier ledger (inventory/equipment) for the active courier. */
  private openInventory(): void {
    const token = readAuthToken();
    const characterId = this.network.getCharacterId();
    if (token === null || token === "" || characterId === null) return;
    CharacterProfilePanel.instance?.open(characterId, token);
  }

  private requestBasicAttack(): void {
    if (this.isDefeated || dialoguePanel.isOpen()) return;
    const targetId = this.network.attackNearest(
      {
        x: Math.floor(this.player.x / TILE_SIZE),
        y: Math.floor(this.player.y / TILE_SIZE),
      },
      ATTACK_TARGET_RANGE,
    );
    if (targetId !== null) {
      this.player.playAttack();
    }
  }

  private buildTilemap(map: MapData): void {
    const grid = map.rows.map((row) =>
      row.split("").map((ch) => TILE_INDEX[ch] ?? -1),
    );
    const tilemap = this.make.tilemap({
      data: grid,
      tileWidth: TILE_SIZE,
      tileHeight: TILE_SIZE,
      width: map.width,
      height: map.height,
    });
    const tileset = tilemap.addTilesetImage(
      "main",
      TextureKeys.TilesetMain,
      TILE_SIZE,
      TILE_SIZE,
    );
    if (!tileset) {
      console.error("OverworldScene: tileset-main texture missing");
      return;
    }
    // `gpu` defaults to false in createLayer, so this is the regular
    // TilemapLayer (the one Arcade physics colliders accept).
    const layer = tilemap.createLayer(0, tileset, 0, 0) as Phaser.Tilemaps.TilemapLayer;
    // Set all four collision faces and recalculate them across the complete
    // layer. This keeps adjacent solid tiles symmetric at their exposed edges.
    layer.setCollision([...COLLIDING_TILE_INDICES], true, true);
    const covered = new Set(TERRAIN_BY_ZONE[map.id]?.coveredBlockingCodes ?? []);
    // Only blocking tiles stay on the tile map: every non-blocking tile is
    // drawn by the authored surface, and leaving one visible would paint a flat
    // procedural square over the art.
    //
    // A blocking tile whose square the zone suppresses is hidden only where the
    // plan actually put art over it. Per *tile* rather than per code, because
    // the cover rule deliberately keeps off reserved tiles — so hiding by code
    // alone would leave a solid, invisible obstacle beside an interactable and
    // the courier would stop at nothing. Where no art stands in, the plain
    // square stays: visibly solid beats invisibly solid.
    layer.forEachTile((tile) => {
      const code = map.rows[tile.y]?.[tile.x] ?? "";
      if (!tile.collides) {
        tile.visible = false;
        return;
      }
      const suppressed = covered.has(code);
      tile.visible = !suppressed || !this.terrainPlan?.coveredBlockingTiles.has(`${tile.x},${tile.y}`);
    });
    // Above the terrain surface (see TERRAIN_DEPTH) but below every entity, so
    // a surviving obstacle square never draws over the courier.
    layer.setDepth(-10);
    this.groundLayer = layer;
  }

  /** Spawns the NPCs whose homeZone is the current zone (npcs.json). */
  private buildNpcs(map: MapData): void {
    const zoneNpcs = NPCS.filter((n) => n.homeZone === map.id);
    for (const def of zoneNpcs) {
      const npc = new NPC(this, def);
      this.visualNpcs.push(npc);
      this.physics.add.collider(this.player, npc);
    }
  }

  /** Download a live canvas screenshot and matching scene metadata bundle. */
  private async captureVisualReview(): Promise<void> {
    const canvas = this.game.canvas;
    if (!(canvas instanceof HTMLCanvasElement) || canvas.width === 0) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const imageName = `paws-visual-${stamp}.png`;
    const metadataName = `paws-visual-${stamp}.json`;
    const metadata: VisualSceneMetadata = {
      zoneId: this.mapData.id,
      zoneName: this.mapData.name,
      map: { width: this.mapData.width, height: this.mapData.height },
      camera: {
        zoom: this.cameras.main.zoom,
        viewportWidth: this.scale.width,
        viewportHeight: this.scale.height,
      },
      visibleTiles: {
        x: Math.ceil(this.scale.width / TILE_SIZE / this.cameras.main.zoom),
        y: Math.ceil(this.scale.height / TILE_SIZE / this.cameras.main.zoom),
      },
      entities: [
        {
          id: "local-player",
          kind: "player",
          x: this.player.x / TILE_SIZE,
          y: this.player.y / TILE_SIZE,
          scale: this.player.scale,
          depth: this.player.depth,
          asset: this.player.classKey,
        },
        ...this.visualNpcs.filter((npc) => npc.visible).map((npc) => ({
          id: npc.definition.id,
          kind: "npc" as const,
          x: npc.x / TILE_SIZE,
          y: npc.y / TILE_SIZE,
          scale: npc.scale,
          depth: npc.depth,
          asset: npc.npcArtKey,
        })),
        ...this.visualSetPieces.map((piece, index) => ({
          id: `set-piece-${index}`,
          kind: "set-piece" as const,
          x: piece.x / TILE_SIZE,
          y: piece.y / TILE_SIZE,
          scale: piece.scale,
          depth: piece.depth,
          asset:
            piece.getData("cloverVillageAsset") ??
            piece.getData("happyValleyAsset") ??
            piece.texture.key,
        })),
        ...this.visualInteractables.map((object) => ({
          id: object.id,
          kind: "interactable" as const,
          x: object.x,
          y: object.y,
          asset: object.kind,
        })),
        ...this.network.getVisualEntities(),
      ],
      notes: [
        "Captured from the live Phaser canvas with Ctrl+Shift+V.",
        "The screenshot excludes DOM overlays; metadata includes the world entities used for visual review.",
      ],
    };
    // In 3D the world lives on the WebGL canvas, so a capture has to come from
    // there rather than from the sprite canvas the HUD sits over.
    const snapshot = await captureRenderedPng(this, this.world3d?.worldCanvas);
    if (snapshot === null) {
      showCaptureToast("Capture was not saved", "The rendered frame could not be captured", true);
      return;
    }
    const token = readAuthToken();
    if (token === null || token === "") {
      showCaptureToast("Capture was not saved", "Admin sign-in is required", true);
      return;
    }
    const image = await blobToDataUrl(snapshot);
    try {
      const response = await fetch(apiPath("/api/admin/visual-capture"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        credentials: "omit",
        body: JSON.stringify({ image, metadata }),
      });
      if (!response.ok) {
        const reason = await readCaptureError(response);
        showCaptureToast(
          `Capture rejected (${response.status})`,
          reason,
          true,
        );
        return;
      }
      const result = (await response.json()) as {
        imageFile?: unknown;
        metadataFile?: unknown;
      };
      const savedImage = typeof result.imageFile === "string" ? result.imageFile : imageName;
      const savedMetadata = typeof result.metadataFile === "string" ? result.metadataFile : metadataName;
      showCaptureToast(savedImage, savedMetadata);
    } catch {
      showCaptureToast("Capture was not saved", "Could not reach the game server", true);
    }
  }

  /** Renders a small marker on each map object the player can interact with. */
  private buildObjectMarkers(map: MapData): void {
    for (const obj of map.interactables) {
      this.add
        .image(
          obj.x * TILE_SIZE + TILE_SIZE / 2,
          obj.y * TILE_SIZE + TILE_SIZE / 2,
          TextureKeys.ObjectMarker,
        )
        .setDepth(worldDepth(obj.y * TILE_SIZE + TILE_SIZE / 2, DEPTH_OFFSET.overlay))
        .setTint(0xd8b28a);
    }
  }

  private buildInteractionSystem(map: MapData): void {
    const npcTargets: InteractionTarget[] = NPCS.filter(
      (n) => n.homeZone === map.id,
    ).map((n) => ({
      id: n.id,
      kind: "npc" as const,
      label: n.name,
      x: n.homeTile.x * TILE_SIZE + TILE_SIZE / 2,
      y: n.homeTile.y * TILE_SIZE + TILE_SIZE / 2,
      npcId: n.id,
      // Over the name tag: that is what already occupies the space above a
      // villager's head, and the badge must not sit on it.
      promptOffsetPx: promptOffsetAbove(
        entityNameTagOffsetPx(villagerSizing(npcArtForDefinition(n))),
        NPC_NAME_TAG_HEIGHT_PX,
      ),
    }));
    const objectTargets: InteractionTarget[] = map.interactables.map(
      (o: MapInteractable) => ({
        id: o.id,
        kind: o.kind,
        label: o.label,
        x: o.x * TILE_SIZE + TILE_SIZE / 2,
        y: o.y * TILE_SIZE + TILE_SIZE / 2,
        lines: o.lines,
        // Over the object's marker plaque, which is centred on its tile.
        promptOffsetPx: promptOffsetAbove(0, OBJECT_MARKER_SIZE_PX),
      }),
    );
    this.interactionSystem = new InteractionSystem([...npcTargets, ...objectTargets]);
  }

  /**
   * The interaction badge: a keycap over the head of the focused target.
   *
   * Local rendering only — it is built from this courier's own focus and never
   * goes over the socket, so a nearby player generates their own badge (or none)
   * and never sees this one.
   */
  private buildPrompt(): void {
    const touch = this.sys.game.device.input.touch;
    const label = touch ? "Tap" : "E";
    const keycap = this.add.rectangle(
      0,
      0,
      touch ? 40 : 22,
      PROMPT_BADGE_HEIGHT_PX,
      0x203b2d,
      0.92,
    );
    keycap.setStrokeStyle(2, 0xe7c979, 0.9);
    const text = this.add.text(0, 0, label, {
      fontFamily: "Trebuchet MS, Arial, sans-serif",
      fontSize: touch ? "11px" : "13px",
      color: "#fff8e8",
      fontStyle: "bold",
    }).setOrigin(0.5);
    this.prompt = this.add.container(0, 0, [keycap, text]).setDepth(120);
    this.prompt.setVisible(false);
  }

  /**
   * Hang the badge over the focused target's head, or take it away.
   *
   * Moving between targets is what triggers the pop; re-anchoring to the same
   * target each frame just keeps it pinned while the player walks around it.
   */
  private updatePrompt(focused: InteractionTarget | null): void {
    if (!focused) {
      this.prompt.setVisible(false);
      this.promptTargetId = null;
      this.badge3d = null;
      return;
    }
    const moved = this.promptTargetId !== focused.id;
    this.promptTargetId = focused.id;
    this.prompt.setPosition(focused.x, focused.y + focused.promptOffsetPx);
    // The 3D badge hangs the same distance above the target's own art; the
    // sprite badge stays positioned too, so `?renderer=2d` and the visual
    // probes see the same focus either way.
    this.badge3d = {
      x: focused.x / TILE_SIZE,
      y: -focused.promptOffsetPx / TILE_SIZE,
      z: focused.y / TILE_SIZE,
    };
    // Sorted with the world at the target's own Y (the same band its name tag
    // uses) rather than pinned on top of everything: a foreground set piece the
    // NPC is standing behind should hide the badge with them.
    this.prompt.setDepth(worldDepth(focused.y, DEPTH_OFFSET.overlay));
    this.prompt.setVisible(true);
    if (moved) this.popPromptIn();
  }

  /** A short scale-in so a new target reads as "this one", not "something". */
  private popPromptIn(): void {
    this.tweens.killTweensOf(this.prompt);
    // The HUD honors prefers-reduced-motion in CSS; the canvas has to ask.
    const reduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches === true;
    this.prompt.setScale(reduced ? 1 : 0.7);
    if (reduced) return;
    this.tweens.add({
      targets: this.prompt,
      scale: 1,
      duration: 140,
      ease: "back.out",
    });
  }

  private tapHits(worldX: number, worldY: number, focused: InteractionTarget | null): boolean {
    if (!focused) return false;
    return Math.hypot(worldX - focused.x, worldY - focused.y) < TILE_SIZE * 1.6;
  }

  private showQuestMilestoneDialogue(questId: string, action: string): void {
    const quest = QUESTS.find((entry) => entry.id === questId);
    const script = action === "accepted" ? quest?.acceptanceDialogue : quest?.completionDialogue;
    if (script === undefined || script.lines.length === 0) return;
    const speaker = NPCS.find((npc) => npc.id === script.speakerId)?.name ?? "Village resident";
    if (dialoguePanel.isOpen()) {
      // Milestones can land while the villager is still on screen (a delivery
      // completing mid-conversation) — replace the beat instead of appending.
      dialoguePanel.present({ speaker, lines: [...script.lines] });
      return;
    }
    dialoguePanel.open({ speaker, lines: [...script.lines] }, () => undefined);
  }

  /**
   * Every conversation ends in the villager's menu — the same hub for all
   * five villagers, so the loop is learnable in one meeting. Quest hands the
   * conversation back to the scene's accept flow; Shop answers honestly
   * (no shop is built); Exit closes.
   */
  private static readonly NPC_MENU: { id: string; label: string }[] = [
    { id: "quest", label: "Quest" },
    { id: "shop", label: "Shop" },
    { id: "exit", label: "Exit" },
  ];

  private startInteraction(target: InteractionTarget): void {
    if (target.kind === "npc") {
      const npcId = target.npcId ?? "";
      const set = selectDialogueSet(DIALOGUE, npcId, 0);
      const introLines = set !== null && set.lines.length > 0 ? set.lines : [`${target.label} greets you warmly.`];
      dialoguePanel.open(
        {
          speaker: target.label,
          lines: introLines,
          menu: OverworldScene.NPC_MENU,
          onSelect: (id) => this.handleNpcMenuChoice(npcId, id),
        },
        () => undefined,
      );
      this.network.interact(npcId);
      // AI game engine: the world-brain opens the conversation in character
      // (the canned intro is the fallback that must never block) with a scene
      // snapshot; the line replaces the first one while the reader is on it.
      void this.requestAiNpcLine(npcId);
    } else {
      dialoguePanel.open({ speaker: target.label, lines: target.lines ?? [] }, () => undefined);
      const active = this.questTracker.getActiveQuest();
      if (active?.searchObjectId === target.id) this.network.searchQuest(target.id);
    }
  }

  /** The villager menu's three choices. Quest reuses the accept flow; the
   * rest stay conversational — the panel stays open so the menu survives. */
  private handleNpcMenuChoice(npcId: string, id: string): void {
    if (id === "quest") {
      // The panel stays open: the offer is presented in the conversation, and
      // the tracker's Accept button (revealed by setOffer) completes it.
      this.offerNpcQuest(npcId);
      return;
    }
    if (id === "shop") {
      const name = NPCS.find((npc) => npc.id === npcId)?.name ?? "This villager";
      dialoguePanel.present({
        speaker: name,
        lines: [`${name} rummages behind the counter... "No shop out here yet — deliveries first!"`],
        menu: OverworldScene.NPC_MENU,
        onSelect: (next) => this.handleNpcMenuChoice(npcId, next),
      });
      return;
    }
    // "exit" — and anything unrecognized — ends the conversation.
    dialoguePanel.close();
  }

  /**
   * Surface the villager's quest as an accept offer, or say why there is
   * nothing to take. Uses the server's quest state only — nothing here decides
   * quest availability client-side. Previously this flow only ran on proximity
   * (npc_interaction), so a player standing beside the villager before opening
   * the menu never saw an offer appear.
   */
  private offerNpcQuest(npcId: string): void {
    const quests = [...this.questTracker.getQuests()];
    const offered = quests.find(
      (quest) => quest.giverId === npcId && quest.state === "available",
    );
    const name = NPCS.find((npc) => npc.id === npcId)?.name ?? "This villager";
    if (offered !== undefined) {
      this.questTracker.setQuests(quests);
      this.questTracker.setOffer(offered.questId);
      dialoguePanel.present({
        speaker: name,
        lines: [offered.description],
        menu: OverworldScene.NPC_MENU,
        onSelect: (next) => this.handleNpcMenuChoice(npcId, next),
      });
      return;
    }
    const active = this.questTracker.getActiveQuest();
    const line =
      active !== undefined
        ? `You still have a delivery in your paws — finish "${active.title}" first!`
        : `${name} has nothing new just now. Check back after your next delivery!`;
    dialoguePanel.present({
      speaker: name,
      lines: [line],
      menu: OverworldScene.NPC_MENU,
      onSelect: (next) => this.handleNpcMenuChoice(npcId, next),
    });
  }

  /**
   * Ask the game server's world-brain for an AI line from this NPC. Never
   * blocks the dialogue (canned lines already open); every failure keeps the
   * canned dialogue. Includes a throttled scene snapshot so the model can
   * "see" what the courier is looking at.
   */
  /**
   * Ask the game server's world-brain (the Qwen-class local model behind the
   * AI game engine) for the NPC's introduction in character. The panel opens
   * instantly with the canned intro; the AI line replaces it in place when it
   * arrives — so the model's answer is what the player reads first, and every
   * failure keeps the canned line (the model is never on the critical path).
   */
  private async requestAiNpcLine(npcId: string): Promise<void> {
    const now = Date.now();
    if (now - this.lastNpcTalkAt < NPC_TALK_MIN_INTERVAL_MS) return;
    this.lastNpcTalkAt = now;
    const token = readAuthToken();
    if (token === null || token === "") return;
    const characters = readBootCharacters();
    const playerName =
      pickCharacter(characters, readSelectedCharacterId())?.name ?? undefined;
    const body: Record<string, unknown> = { npcId, playerName };
    const sceneImage = this.throttledSceneSnapshot();
    if (sceneImage !== null) body.sceneImage = sceneImage;
    try {
      const res = await fetch(apiPath("/api/npc/talk"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        credentials: "omit",
        body: JSON.stringify(body),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { line?: unknown; source?: unknown };
      if (data.source === "ai" && typeof data.line === "string" && data.line !== "") {
        dialoguePanel.setIntroLine(data.line);
      }
    } catch {
      // Canned dialogue remains — the world-brain can be unavailable.
    }
  }

  /** The game canvas as a small JPEG data URL, throttled; null when not ready. */
  private throttledSceneSnapshot(): string | null {
    const now = Date.now();
    if (now - this.lastSceneSnapshotAt < SCENE_SNAPSHOT_MIN_INTERVAL_MS) return null;
    this.lastSceneSnapshotAt = now;
    // Direct child: #hud-layer now precedes the Phaser canvas inside
    // #game-container, so a plain descendant selector would pick up the
    // minimap's canvas and send the model a 75x75 map thumbnail instead of
    // the world the courier is looking at.
    const canvas = document.querySelector("#game-container > canvas");
    if (!(canvas instanceof HTMLCanvasElement) || canvas.width === 0) return null;
    try {
      const scale =
        canvas.width > SCENE_SNAPSHOT_MAX_WIDTH
          ? SCENE_SNAPSHOT_MAX_WIDTH / canvas.width
          : 1;
      const w = Math.max(1, Math.round(canvas.width * scale));
      const h = Math.max(1, Math.round(canvas.height * scale));
      const tmp = document.createElement("canvas");
      tmp.width = w;
      tmp.height = h;
      const ctx = tmp.getContext("2d");
      if (ctx === null) return null;
      ctx.drawImage(canvas, 0, 0, w, h);
      return tmp.toDataURL("image/jpeg", 0.45);
    } catch {
      return null;
    }
  }

  private addUi(): void {
    // Controls are communicated by the persistent HUD now; keep the world
    // clear so the reference composition reads as a game, not a debug canvas.
  }

  /** The quick inventory button lives in InventoryButton (HUD v4); kept for API parity. */
  private buildQuickMenu(): void {
    // no-op — InventoryButton is constructed with the other HUD components.
  }

  /** Snap the courier to a server-authoritative tile (join/reconnect restore). */
  private placeAtTile(tile: MapPoint): void {
    this.player.setPosition(
      tile.x * TILE_SIZE + TILE_SIZE / 2,
      tile.y * TILE_SIZE + TILE_SIZE / 2,
    );
    this.lastTileX = tile.x;
    this.lastTileY = tile.y;
  }

  private checkTransition(): void {
    const tileX = Math.floor(this.player.x / TILE_SIZE);
    const tileY = Math.floor(this.player.y / TILE_SIZE);
    if (tileX === this.lastTileX && tileY === this.lastTileY) return;
    this.lastTileX = tileX;
    this.lastTileY = tileY;
    if (this.isTransitioning) return;

    const transition = this.mapData.transitions.find(
      (t) => t.x === tileX && t.y === tileY,
    );
    if (!transition) return;

    this.isTransitioning = true;
    this.network.joinZone(transition.toZone);
    this.scene.restart({
      zoneId: transition.toZone,
      spawn: transition.spawn,
    } satisfies OverworldSceneData);
  }
}

/** Downscale a live canvas into a PNG blob, within the server's byte budget. */
async function captureCanvasPng(source: HTMLCanvasElement): Promise<Blob | null> {
  if (source.width === 0 || source.height === 0) return null;
  const scale =
    source.width > VISUAL_CAPTURE_MAX_WIDTH ? VISUAL_CAPTURE_MAX_WIDTH / source.width : 1;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const context = canvas.getContext("2d");
  if (context === null) return null;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return capturePngBlob(canvas, canvas.width);
}

async function captureRenderedPng(
  scene: Phaser.Scene,
  worldCanvas?: HTMLCanvasElement,
): Promise<Blob | null> {
  if (worldCanvas !== undefined) return captureCanvasPng(worldCanvas);
  const renderer = scene.sys.game.renderer as Phaser.Renderer.WebGL.WebGLRenderer | Phaser.Renderer.Canvas.CanvasRenderer;
  return new Promise((resolve) => {
    try {
      renderer.snapshot((snapshot) => {
        if (!(snapshot instanceof HTMLImageElement) || snapshot.width === 0 || snapshot.height === 0) {
          resolve(null);
          return;
        }
        const canvas = document.createElement("canvas");
        const scale = snapshot.width > VISUAL_CAPTURE_MAX_WIDTH
          ? VISUAL_CAPTURE_MAX_WIDTH / snapshot.width
          : 1;
        canvas.width = Math.max(1, Math.round(snapshot.width * scale));
        canvas.height = Math.max(1, Math.round(snapshot.height * scale));
        const context = canvas.getContext("2d");
        if (context === null) {
          resolve(null);
          return;
        }
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";
        context.drawImage(snapshot, 0, 0, canvas.width, canvas.height);
        void capturePngBlob(canvas, canvas.width).then(resolve);
      }, "image/png");
    } catch {
      resolve(null);
    }
  });
}

async function capturePngBlob(canvas: HTMLCanvasElement, maxWidth: number): Promise<Blob | null> {
  let width = Math.min(canvas.width, maxWidth);
  while (width >= 240) {
    try {
      const height = Math.max(1, Math.round(canvas.height * (width / canvas.width)));
      const source = width === canvas.width && height === canvas.height
        ? canvas
        : document.createElement("canvas");
      if (source !== canvas) {
        source.width = width;
        source.height = height;
        const context = source.getContext("2d");
        if (context === null) return null;
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";
        context.drawImage(canvas, 0, 0, width, height);
      }
      const blob = await new Promise<Blob | null>((resolve) => source.toBlob(resolve, "image/png"));
      if (blob !== null && blob.size <= VISUAL_CAPTURE_MAX_BYTES) return blob;
    } catch {
      return null;
    }
    width = Math.floor(width * 0.75);
  }
  return null;
}

async function readCaptureError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown; message?: unknown };
    if (typeof body.error === "string" && typeof body.message === "string") {
      return `${body.error}: ${body.message}`;
    }
    if (typeof body.message === "string") return body.message;
  } catch {
    // Fall through to the status text when the proxy returned non-JSON.
  }
  return response.statusText || "The server rejected the upload";
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error("Could not read capture image"));
    reader.readAsDataURL(blob);
  });
}

let captureToastTimer: ReturnType<typeof setTimeout> | null = null;

/** Show a short, non-interactive confirmation after the server saves both files. */
function showCaptureToast(imageName: string, metadataName: string, error = false): void {
  const container = document.getElementById("game-container");
  if (container === null) return;

  const existing = container.querySelector<HTMLElement>(".capture-toast");
  existing?.remove();
  if (captureToastTimer !== null) {
    clearTimeout(captureToastTimer);
    captureToastTimer = null;
  }

  const toast = document.createElement("div");
  toast.className = `capture-toast${error ? " capture-toast--error" : ""}`;
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");
  const icon = document.createElement("span");
  icon.className = "capture-toast__icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = "✓";
  const copy = document.createElement("span");
  copy.className = "capture-toast__copy";
  const title = document.createElement("strong");
  title.textContent = error ? imageName : "Visual capture saved";
  const files = document.createElement("span");
  files.textContent = error ? metadataName : `${imageName} + ${metadataName}`;
  copy.append(title, files);
  toast.append(icon, copy);
  container.appendChild(toast);

  captureToastTimer = setTimeout(() => {
    toast.classList.add("capture-toast--leaving");
    captureToastTimer = setTimeout(() => {
      toast.remove();
      captureToastTimer = null;
    }, 180);
  }, 3_800);
}
