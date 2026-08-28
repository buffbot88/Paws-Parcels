import Phaser from "phaser";
import { TILE_SIZE } from "../game/GameConfig.ts";
import { SceneKeys, TextureKeys, ZoneKeys } from "../game/GameConstants.ts";
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
import type { VisualSceneMetadata } from "../types/VisualSceneMetadata.ts";
import npcsJson from "../data/npcs.json" with { type: "json" };
import dialogueJson from "../data/dialogue.json" with { type: "json" };
import questsJson from "../data/quests.json" with { type: "json" };
import type { NPC as NPCDefinition } from "../types/NPCtypes.ts";
import type { DialogueSet } from "../types/DialogueTypes.ts";
import type { QuestDefinition } from "../types/QuestTypes.ts";
import { worldDepth } from "../game/WorldDepth.ts";

export interface OverworldSceneData {
  zoneId?: string;
  spawn?: MapPoint;
}

const NPCS = npcsJson.npcs as NPCDefinition[];
const DIALOGUE = dialogueJson.dialogue as DialogueSet[];
const QUESTS = questsJson.quests as QuestDefinition[];
/** One DOM panel for the whole app — scenes come and go, the overlay persists. */
export const dialoguePanel = new DialoguePanel();
/** Client-side attack-pickup radius (tiles); the server enforces the real range. */
const ATTACK_TARGET_RANGE = 6;
/** Min ms between AI NPC line requests (server also rate-limits). */
const NPC_TALK_MIN_INTERVAL_MS = 6_000;
/** Min ms between scene snapshots sent to the model (1-core protection). */
const SCENE_SNAPSHOT_MIN_INTERVAL_MS = 8_000;
/** Scene snapshot max width before downscaling (keeps VL calls cheap). */
const SCENE_SNAPSHOT_MAX_WIDTH = 320;
/** Capture uploads are downscaled to stay below the server's bounded PNG/body limits. */
const VISUAL_CAPTURE_MAX_WIDTH = 800;
/** Leave headroom below the server's 1.5 MB decoded PNG limit. */
const VISUAL_CAPTURE_MAX_BYTES = 1_400_000;

/**
 * The zone-capable world scene (Phase 2-3): builds a tilemap from the custom
 * JSON maps, collides the player, follows with a clamped camera, restarts on
 * transition tiles, and exposes NPCs + objects with tap/E-Space interaction
 * and a DOM dialogue overlay.
 */
export class OverworldScene extends Phaser.Scene {
  private player!: Player;
  private shadow!: Phaser.GameObjects.Image;
  private lastNpcTalkAt = 0;
  private lastSceneSnapshotAt = 0;
  private captureInProgress = false;
  private inputSystem!: InputSystem;
  private interactionSystem!: InteractionSystem;
  private mapData!: MapData;
  private groundLayer!: Phaser.Tilemaps.TilemapLayer;
  private prompt!: Phaser.GameObjects.Container;
  private minimap!: Minimap;
  private skillBar!: SkillBar;
  private chatBox!: ChatBox;
  private questTracker!: QuestTracker;
  private lastTileX = -1;
  private lastTileY = -1;
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

    this.buildTilemap(resolved);
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
    this.shadow = this.add
      .image(this.player.x, this.player.y + 12, TextureKeys.PlayerShadow)
      .setDepth(worldDepth(this.player.y, -0.08));
    this.player.setDepth(worldDepth(this.player.y));

    // Collide with the ground layer only now that the player exists (and guard
    // in case buildTilemap bailed, so we never pass undefined to the collider).
    if (this.groundLayer) {
      this.physics.add.collider(this.player, this.groundLayer);
    }

    this.buildNpcs(resolved);
    this.visualInteractables = resolved.interactables;
    this.buildObjectMarkers(resolved);
    this.buildInteractionSystem(resolved);

    const camera = this.cameras.main;
    camera.setBounds(0, 0, resolved.width * TILE_SIZE, resolved.height * TILE_SIZE);
    // Clover Village is the large shared hub, but the courier should remain
    // readable. A modest zoom-in enlarges every world character together while
    // preserving the existing tile scale, collision, and camera bounds.
    camera.setZoom(this.mapData.id === ZoneKeys.CloverVillage ? 0.8 : 1);
    // Keep fractional camera positions for smooth 2.5D art; integer camera
    // rounding would make movement look like pixel-art stepping.
    camera.startFollow(this.player, false, 0.12, 0.12);

    this.addUi();
    this.buildPrompt();

    // Phase 4 — world minimap: pre-renders this zone's terrain once and
    // tracks the courier + network entities live each frame.
    this.minimap = new Minimap();
    this.minimap.attach(resolved, NPCS);
    this.skillBar = new SkillBar(() => this.requestBasicAttack());
    this.chatBox = new ChatBox((text) => this.network.chat(text));
    this.questTracker = new QuestTracker((questId) => this.network.acceptQuest(questId));
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
    // Gameplay rejections (quest/inventory/chat/zone) arrive as tagged errors —
    // show them in the same transient notice slot so they're never silent.
    this.network.onGameplayNotice = (message) => this.questTracker.showMessage(message);
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
    };
    this.network.onInventoryUpdated = (_items, _stamps, state) => {
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

    this.inputSystem = new InputSystem(this, { devAccess: hasAdminDevAccess() });

    // Phase 2-3 — multiplayer callbacks. The socket was started above so
    // optional scene decoration cannot block authentication or presence.
    // Defeat = respawn at the safe hub (server says where).
    this.network.onPlayerDefeated = () => {
      this.isDefeated = true;
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
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      for (const object of this.visualGround) object.destroy();
      for (const piece of this.visualSetPieces) piece.destroy();
      for (const shadow of this.visualSetPieceShadows) shadow.destroy();
      this.inputSystem.destroy();
      this.minimap.destroy();
      this.skillBar.destroy();
      this.chatBox.destroy();
      this.questTracker.destroy();
      this.network.detach();
    });
  }

  update(): void {
    // Defeat freeze: let the death pose remain visible until the server sends
    // the authoritative respawn payload.
    if (this.isDefeated) {
      this.player.move({ x: 0, y: 0 });
      this.player.setDepth(worldDepth(this.player.y));
      this.shadow.setPosition(this.player.x, this.player.y + 12);
      this.shadow.setDepth(worldDepth(this.player.y, -0.08));
      this.skillBar.setVisible(false);
      this.network.update();
      return;
    }

    // Dialogue open: freeze the world, feed E/Space into the panel only.
    if (dialoguePanel.isOpen()) {
      this.player.move({ x: 0, y: 0 });
      this.player.setDepth(worldDepth(this.player.y));
      this.shadow.setPosition(this.player.x, this.player.y + 12);
      this.shadow.setDepth(worldDepth(this.player.y, -0.08));
      this.skillBar.setVisible(false);
      if (this.inputSystem.consumeInteract()) dialoguePanel.advance();
      this.prompt.setVisible(false);
      return;
    }

    this.skillBar.setVisible(true);
    const vector = this.inputSystem.getMoveVector();
    this.player.move(vector);
    this.player.setDepth(worldDepth(this.player.y));
    this.shadow.setPosition(this.player.x, this.player.y + 12);
    this.shadow.setDepth(worldDepth(this.player.y, -0.08));

    // Phase 2 — send a throttled move intent (dominant axis only; the server
    // rejects diagonals) and interpolate other couriers' snapshots.
    if (Math.abs(vector.x) >= Math.abs(vector.y)) {
      this.network.moveIntent(Math.sign(vector.x), 0);
    } else {
      this.network.moveIntent(0, Math.sign(vector.y));
    }

    // Phase 3 — attack: J targets the nearest monster in class range (the
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

    // Phase 4 — minimap live layer (own courier, others, monsters).
    this.minimap.update({
      player: {
        x: this.player.x / TILE_SIZE,
        y: this.player.y / TILE_SIZE,
      },
      players: this.network.getRemotePositions(),
      monsters: this.network.getMonsterPositions(),
    });

    const focused = this.interactionSystem.getFocused(
      this.player.x,
      this.player.y,
      TILE_SIZE,
    );
    this.updatePrompt(focused);
    this.prompt.setVisible(focused !== null);

    const tap = this.inputSystem.consumeTap();
    const interacted =
      (tap && this.tapHits(tap.worldX, tap.worldY, focused)) ||
      this.inputSystem.consumeInteract();

    if (interacted && focused) {
      this.startInteraction(focused);
    }

    this.checkTransition();
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
    if (map.id === ZoneKeys.CloverVillage) {
      // Clover Village has an authored ground/road surface above the normal
      // tile art. Keep only blocking tiles rendered by this layer so every
      // physical obstacle still has a visible representation.
      layer.forEachTile((tile) => {
        tile.visible = tile.collides;
      });
      layer.setDepth(-10);
    }
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
          asset: piece.getData("cloverVillageAsset") ?? piece.texture.key,
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
    const snapshot = await captureRenderedPng(this);
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
        .setDepth(worldDepth(obj.y * TILE_SIZE + TILE_SIZE / 2, 0.04))
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
    }));
    const objectTargets: InteractionTarget[] = map.interactables.map(
      (o: MapInteractable) => ({
        id: o.id,
        kind: o.kind,
        label: o.label,
        x: o.x * TILE_SIZE + TILE_SIZE / 2,
        y: o.y * TILE_SIZE + TILE_SIZE / 2,
        lines: o.lines,
      }),
    );
    this.interactionSystem = new InteractionSystem([...npcTargets, ...objectTargets]);
  }

  /** Cozy hint bar shown above the player when something is in range. */
  private buildPrompt(): void {
    const bg = this.add.rectangle(0, 0, 210, 28, 0xffffff, 0.85);
    const text = this.add.text(0, 0, "", {
      fontFamily: "Georgia, serif",
      fontSize: "14px",
      color: "#3a5a3a",
    });
    text.setOrigin(0.5);
    this.prompt = this.add.container(0, 0, [bg, text]).setDepth(100);
    this.prompt.setVisible(false);
  }

  private updatePrompt(focused: InteractionTarget | null): void {
    const text = this.prompt.list[1] as Phaser.GameObjects.Text;
    if (!focused) {
      this.prompt.setVisible(false);
      return;
    }
    const touch = this.sys.game.device.input.touch;
    const verb = touch ? "Tap" : "Press E";
    text.setText(`${verb} to talk to ${focused.label}`);
    this.prompt.setPosition(this.player.x, this.player.y - 36);
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
      for (const line of script.lines) dialoguePanel.appendLine(line);
      return;
    }
    dialoguePanel.open({ speaker, lines: script.lines }, () => undefined);
  }

  private startInteraction(target: InteractionTarget): void {
    if (target.kind === "npc") {
      const set = selectDialogueSet(DIALOGUE, target.npcId ?? "", 0);
      if (!set) {
        console.error(`OverworldScene: no dialogue for npc "${target.npcId}"`);
        return;
      }
      dialoguePanel.open({ speaker: target.label, lines: set.lines }, () => undefined);
      this.network.interact(target.npcId ?? "");
      // AI game engine: the world-brain answers in character with a scene
      // snapshot; the line is appended when it arrives (canned stays the base).
      void this.requestAiNpcLine(target.npcId ?? "");
    } else {
      dialoguePanel.open({ speaker: target.label, lines: target.lines ?? [] }, () => undefined);
      const active = this.questTracker.getActiveQuest();
      if (active?.searchObjectId === target.id) this.network.searchQuest(target.id);
    }
  }

  /**
   * Ask the game server's world-brain for an AI line from this NPC. Never
   * blocks the dialogue (canned lines already open); every failure keeps the
   * canned dialogue. Includes a throttled scene snapshot so the model can
   * "see" what the courier is looking at.
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
        dialoguePanel.appendLine(data.line);
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
    const canvas = document.querySelector("#game-container canvas");
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
    this.add
      .text(12, this.scale.height - 32, "WASD / arrows / drag to move · E or tap to talk", {
        fontFamily: "Georgia, serif",
        fontSize: "15px",
        color: "#3a5a3a",
        backgroundColor: "#ffffff99",
        padding: { x: 8, y: 4 },
      })
      .setScrollFactor(0)
      .setDepth(100);
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

async function captureRenderedPng(scene: Phaser.Scene): Promise<Blob | null> {
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
