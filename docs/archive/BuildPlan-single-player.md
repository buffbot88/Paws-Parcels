> ## 🗃 ARCHIVED — HISTORICAL DOCUMENT (non-authoritative)
>
> This is the **original single-player cozy RPG build plan**, preserved for history.
> It was superseded on **2026-08-03 (Phase 3.5 documentation pivot)** by the current
> [`BuildPlan.md`](../../BuildPlan.md), which describes the **browser-based,
> server-authoritative 2.5D multiplayer RPG/MMORPG** direction.
>
> **Do not implement features from this document.** Anything here that conflicts
> with the current `BuildPlan.md` or [`design/decisions.md`](../../design/decisions.md)
> is out of scope. It exists only to record what was originally planned.
> Status marker: 🗃 archived

# Paws & Parcels: MVP Build Plan (ARCHIVED — single-player)

## 1. Stack & Architecture
*   **Engine:** Phaser 3 (Canvas/WebGL rendering)
*   **Language & Tooling:** TypeScript, Vite
*   **UI:** DOM-over-Canvas (HTML/CSS layered above the game canvas for accessibility/responsiveness)
*   **State/Storage:** Singleton `GameManager` class persisting to `localStorage`
*   **Deployment:** Vercel or Netlify (Static hosting)

## 2. Folder Structure
```text
/src
  /assets        # Images, audio, tilemaps (JSON)
  /components    # UI elements (DOM/HTML overlays)
  /data          # JSON content (Quests, NPC dialogue, Item stats)
  /scenes        # Phaser Scenes (Boot, Preloader, MainMenu, Overworld)
  /systems       # Logic (InventoryManager, QuestManager, SaveSystem)
  main.ts        # Entry point, Phaser config, UI mount
3. Phased Milestones
Phase 1: Foundation & Movement (Week 1)
Setup: Initialize Vite + TS + Phaser.
Map: Load a basic Tiled JSON map (Hub zone) with collision.
Player: Render a placeholder sprite with 4-way WASD/Touch movement.
Camera: Follow player, clamp to map bounds.
Testing Checkpoint: Player can walk around a constrained map on desktop and mobile without crashing.
Phase 2: Interaction & UI Overlay (Week 2)
Architecture: Establish the DOM-to-Canvas event bridge.
Entities: Add interactable static NPCs/objects.
Systems: Implement the prompt system (Press 'E' or tap).
UI: Build the Dialogue Box and Main Menu overlays.
Testing Checkpoint: Player can approach an NPC, trigger a multi-line conversation, and close it.
Phase 3: The Core Loop (Week 3)
Data: Load Items, Quests, and Friendship stats from JSON.
Inventory: Implement pick-up logic and a visual grid UI.
Quests: Implement quest generation, delivery validation, and Stamp reward logic.
Testing Checkpoint: Player can accept a parcel, find the target NPC, deliver it, and see their Stamp count increase.
Phase 4: Persistence, Polish, & Release (Week 4)
Save System: Serialize game state to localStorage on quest completion/zone change. Load on boot.
Audio: Add background music and interaction SFX (mute toggles in UI).
Content Migration: Replace placeholders with final MVP sprites and maps.
Testing Checkpoint: Refreshing the browser loads the player in the exact same state (inventory, stamps, map position).
4. Content Pipeline
Maps: Built in Tiled Map Editor -> exported as JSON.
Sprites: Created in Aseprite -> exported as Sprite Sheets + JSON Atlas.
Data: Managed in simple JSON files or a Google Sheet exported to JSON.
5. Major Risks & Mitigation
Scope Creep (Art): Mitigation: Strictly use placeholder geometric shapes until Phase 4 mechanics are verified.
Canvas vs. DOM Sync: Mitigation: Use an Event Emitter pattern. Phaser emits OPEN_INVENTORY, DOM listens and overlays HTML. Never build complex scrolling UI in Phaser.
Mobile Controls: Mitigation: Implement virtual joystick and touch-to-interact in Phase 1; don't tack it on at the end.
6. MVP Definition of Done (DoD)
The game is hosted on a live URL.
A player can complete 1 daily delivery loop.
Inventory, Stamps, and NPC friendship variables update correctly.
Progress survives a browser refresh.
Playable at 30+ FPS on both a modern desktop browser and a standard smartphone.

Paws & Parcels — MVP Build Plan
1. Project Goal
Build a cozy, browser-based 2D RPG where players:

Choose and customize a small animal courier.
Explore a magical forest.
Accept and complete delivery quests.
Gather resources.
Build friendships with NPCs.
Purchase upgrades and cosmetics.
Save progress locally in the browser.
The MVP should prioritize a polished core gameplay loop over a large amount of content.

2. Recommended Stack
Area	Technology
Language	TypeScript
Game engine	Phaser 3
Build tool	Vite
UI	HTML/CSS DOM overlays
Rendering	Canvas/WebGL through Phaser
Maps	Tiled Map Editor JSON exports
Save system	localStorage, upgradeable to IndexedDB
Asset format	Sprite sheets, texture atlases, JSON data
Hosting	Static web hosting
Testing	Vitest + Playwright
Package manager	npm
Architecture Decision
Use Phaser for:

Movement
Maps
Camera
Sprites
Collisions
World interactions
Use HTML/CSS for:

Dialogue
Inventory
Quests
Settings
Shops
Accessibility-focused menus
3. MVP Scope
Required Features
 New game and continue game
 Animal selection and player naming
 Top-down player movement
 Keyboard controls
 Mobile touch controls
 Clover Post Office hub
 Bramble Patch exploration zone
 Five NPCs
 NPC dialogue
 Delivery quests
 Resource gathering
 Inventory system
 Stamp currency
 Friendship meters
 Three player upgrades
 Local save and load
 Audio settings
 Basic accessibility settings
 Responsive desktop and mobile layout
Not Included in MVP
Multiplayer
Combat
Cloud accounts
Online database
Complex crafting
Housing
Voice acting
Procedurally generated maps
Real-money purchases
4. Project Structure

paws-and-parcels/
├── public/
│   ├── assets/
│   │   ├── audio/
│   │   ├── maps/
│   │   ├── sprites/
│   │   ├── tilesets/
│   │   └── ui/
│   └── favicon.svg
│
├── src/
│   ├── main.ts
│   ├── game/
│   │   ├── GameConfig.ts
│   │   ├── GameEvents.ts
│   │   └── GameManager.ts
│   │
│   ├── scenes/
│   │   ├── BootScene.ts
│   │   ├── PreloaderScene.ts
│   │   ├── MainMenuScene.ts
│   │   ├── CharacterCreationScene.ts
│   │   ├── OverworldScene.ts
│   │   └── TransitionScene.ts
│   │
│   ├── entities/
│   │   ├── Player.ts
│   │   ├── NPC.ts
│   │   ├── Interactable.ts
│   │   └── GatheringNode.ts
│   │
│   ├── systems/
│   │   ├── InputSystem.ts
│   │   ├── InteractionSystem.ts
│   │   ├── QuestSystem.ts
│   │   ├── InventorySystem.ts
│   │   ├── FriendshipSystem.ts
│   │   ├── CurrencySystem.ts
│   │   ├── UpgradeSystem.ts
│   │   └── SaveSystem.ts
│   │
│   ├── ui/
│   │   ├── UIManager.ts
│   │   ├── DialoguePanel.ts
│   │   ├── InventoryPanel.ts
│   │   ├── QuestPanel.ts
│   │   ├── JournalPanel.ts
│   │   ├── ShopPanel.ts
│   │   ├── SettingsPanel.ts
│   │   └── MobileControls.ts
│   │
│   ├── data/
│   │   ├── npcs.json
│   │   ├── items.json
│   │   ├── quests.json
│   │   ├── upgrades.json
│   │   └── dialogue.json
│   │
│   ├── types/
│   │   ├── PlayerTypes.ts
│   │   ├── QuestTypes.ts
│   │   ├── ItemTypes.ts
│   │   ├── NPCtypes.ts
│   │   └── SaveTypes.ts
│   │
│   └── styles/
│       ├── global.css
│       ├── game-ui.css
│       └── responsive.css
│
├── tests/
│   ├── systems/
│   ├── data/
│   └── e2e/
│
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
└── README.md
5. Core Data Models
Player State

interface PlayerState {
  name: string;
  animal: "cat" | "bunny" | "fox" | "bear" | "mouse";
  bodyColor: string;
  eyeColor: string;
  speedLevel: number;
  bagLevel: number;
  stamps: number;
  position: {
    zoneId: string;
    x: number;
    y: number;
  };
}
Item

interface ItemDefinition {
  id: string;
  name: string;
  description: string;
  category: "resource" | "gift" | "delivery" | "quest" | "cosmetic";
  maxStack: number;
  icon: string;
  favoriteBy?: string[];
}
Quest

interface QuestDefinition {
  id: string;
  title: string;
  description: string;
  type: "delivery" | "gathering" | "errand";
  giverId: string;
  targetId?: string;
  requiredItemId?: string;
  requiredQuantity?: number;
  stampReward: number;
  friendshipReward?: number;
}
Save Data

interface SaveData {
  version: number;
  player: PlayerState;
  inventory: Record<string, number>;
  friendships: Record<string, number>;
  activeQuestIds: string[];
  completedQuestIds: string[];
  unlockedZoneIds: string[];
  purchasedUpgradeIds: string[];
  currentDay: number;
  settings: {
    musicVolume: number;
    sfxVolume: number;
    textSpeed: "slow" | "normal" | "fast";
    highContrast: boolean;
    reducedMotion: boolean;
  };
}
6. Implementation Phases
Phase 0: Pre-Production ✅ COMPLETE
Goals
Finalize the smallest playable version before development begins.

> **Status (Phase 0 done):** Locked decisions live in `design/decisions.md` (resolution 960×540, 48×48 tiles, scale FIT). World sketch in `design/world-map.md`, NPC cards in `design/npcs.md`. Content IDs registered in `src/data/{npcs,items,quests,upgrades,dialogue}.json` and validated by `node scripts/validate-content.mjs` (passes). Resolution of the "two exploration zones" spec vs. single-zone MVP discrepancy: BuildPlan is authoritative — only Bramble Patch ships in MVP; Whispering Pines/Sunlit Clearing IDs are reserved for post-MVP.

Tasks
- [x] Confirm MVP feature list.
- [x] Define game resolution and tile size.
- [x] Create a simple world map sketch.
- [x] Define the five initial NPCs.
- [x] Write the first 10–15 quests.
- [x] Create placeholder art requirements.
- [x] Define all item, quest, and upgrade IDs.
- [x] Choose input and UI conventions.
Deliverables
- [x] Approved MVP scope
- [x] Basic design document
- [x] World map sketch
- [x] Data model definitions
- [x] Initial content spreadsheet or JSON files
Exit Criteria
- [x] Every MVP feature has a clear implementation owner.
- [x] No required feature depends on an unselected technology.
- [x] All initial content has stable IDs.
Phase 1: Project Foundation
Goals
Create a running Phaser application with a reliable development workflow.

Tasks
Initialize Vite and TypeScript.
Install and configure Phaser.
Create the Phaser game configuration.
Add Boot and Preloader scenes.
Load one placeholder tileset and player sprite.
Set up global styles and responsive layout.
Add basic error logging.
Create a development README.
Deliverables
Game launches locally.
Assets load successfully.
Phaser canvas appears inside the responsive layout.
TypeScript checks pass.
Exit Criteria

npm run dev
npm run build
npm run typecheck
All commands complete without errors.

Phase 2: World and Player Movement
Goals
Make the world explorable.

Tasks
Create the Clover Post Office map.
Add map layers and collision objects.
Create the player entity.
Implement four-direction movement.
Add camera follow and map boundaries.
Add player idle and walk animations.
Add mobile virtual controls.
Add zone transition triggers.
Deliverables
Playable post office hub.
Player can move around blocked areas.
Camera stays within map bounds.
Keyboard and touch controls work.
Exit Criteria
Player can move for five minutes without crashes.
Collision prevents walking through walls.
Mobile controls do not cover critical UI.
Movement speed is consistent across devices.
Phase 3: Interaction and Dialogue
Goals
Allow players to interact with NPCs and objects.

Tasks
Add NPC entities.
Add interaction ranges.
Create the interaction prompt.
Implement keyboard and touch interaction.
Build the dialogue panel as a DOM component.
Add dialogue progression and closing behavior.
Add mailbox and sign interactions.
Add dialogue data loading from JSON.
Deliverables
Five placeholder NPCs.
Reusable dialogue system.
NPC dialogue appears in the HTML UI.
Interactions pause or restrict player movement appropriately.
Exit Criteria
Player can talk to every NPC.
Dialogue can contain multiple lines.
Dialogue works with keyboard and touch input.
Focus and button states are usable with keyboard navigation.
Phase 4: Inventory and Gathering
Goals
Add exploration rewards and item collection.

Tasks
Create item definitions.
Implement inventory state.
Add inventory capacity rules.
Create gathering nodes for bushes, logs, flowers, and ponds.
Add pickup animations and sound effects.
Build the inventory panel.
Add item descriptions and quantities.
Prevent collection when the inventory is full.
Deliverables
At least five gatherable resources.
Inventory with 12 starting slots.
Visible inventory-full feedback.
Items persist in runtime state.
Exit Criteria
Items cannot exceed their stack limits.
Inventory capacity is correctly enforced.
Gathering nodes respond correctly after collection.
Inventory UI reflects state changes immediately.
Phase 5: Delivery Quest Loop
Goals
Implement the main gameplay loop.

Tasks
Create quest definitions.
Implement quest acceptance.
Add active quest tracking.
Add delivery items to inventory.
Mark quest recipients and destinations.
Validate delivery requirements.
Remove delivered items.
Award Stamps and friendship points.
Add quest completion feedback.
Add daily quest generation.
Deliverables
10–15 playable quests.
Delivery quest tracker.
Quest completion screen or notification.
Stamp rewards.
Friendship rewards.
Exit Criteria
A player can:

Talk to the postmaster.
Accept a delivery.
Locate the correct NPC.
Deliver the package.
Receive Stamps.
Increase NPC friendship.
See the quest marked as complete.
Phase 6: Progression and Journal
Goals
Add longer-term player progression.

Tasks
Implement friendship levels.
Add friendship progress bars.
Add NPC journal entries.
Add friendship-level dialogue unlocks.
Implement three upgrades:
Bigger Satchel
Comfy Boots
Express Badge
Create the post office shop.
Add cosmetic equipment support.
Add upgrade purchase validation.
Deliverables
Journal with NPC friendship information.
Working shop.
Upgrade effects.
Friendship unlocks.
Exit Criteria
Stamps can be earned and spent.
Purchased upgrades persist.
Speed and capacity upgrades have measurable effects.
Friendship thresholds unlock new content.
Phase 7: Save System and Settings
Goals
Make progress reliable and the game comfortable to use.

Tasks
Implement versioned save data.
Add save migration support.
Autosave after important actions.
Add manual save behavior if needed.
Load save data on Continue.
Add New Game and Delete Save flows.
Add audio volume controls.
Add text speed settings.
Add high-contrast mode.
Add reduced-motion mode.
Deliverables
Reliable local save system.
Settings panel.
Save reset confirmation.
Corrupt-save fallback behavior.
Exit Criteria
Refreshing the browser preserves:

Player identity
Position
Inventory
Stamps
Friendships
Quests
Purchased upgrades
Settings
Phase 8: Art, Audio, and Polish
Goals
Replace placeholders and improve the overall experience.

Tasks
Replace placeholder player sprites.
Add final NPC sprites and portraits.
Add final tilesets for both MVP zones.
Add item icons.
Add walking and interaction animations.
Add background music.
Add environmental sounds.
Add UI transitions and reward effects.
Add loading states.
Add empty states for inventory and journal.
Add tutorial prompts.
Deliverables
Consistent art style.
Complete audio pass.
Polished menus.
Final MVP content presentation.
Exit Criteria
No placeholder assets remain in the critical path.
Animations do not impact performance.
Audio can be disabled independently.
Major player actions have visual feedback.
Phase 9: Testing and Release
Goals
Verify that the game is stable and playable on supported devices.

Testing Areas
Functional Testing
New game creation
Player movement
Collision
NPC interaction
Dialogue progression
Item gathering
Inventory capacity
Quest acceptance
Quest completion
Stamp rewards
Friendship progression
Upgrades
Save and load
Delete save
Responsive Testing
Desktop keyboard controls
Mobile touch controls
Small mobile screens
Landscape and portrait layouts
Different browser zoom levels
Accessibility Testing
Keyboard-only navigation
Visible focus states
Text readability
High-contrast mode
Color-independent item recognition
Reduced-motion mode
Audio controls
Performance Testing
Frame rate during normal gameplay
Initial loading time
Asset loading behavior
Memory usage after changing zones
Mobile performance
Automated Tests

tests/
├── systems/
│   ├── inventory.test.ts
│   ├── quests.test.ts
│   ├── friendship.test.ts
│   └── save-system.test.ts
├── data/
│   └── content-validation.test.ts
└── e2e/
    ├── new-game.spec.ts
    ├── delivery-loop.spec.ts
    └── save-load.spec.ts
Manual Playtest
At least three testers should complete:

Character creation.
First dialogue sequence.
First delivery.
First gathering activity.
First upgrade purchase.
Browser refresh and save restoration.
7. Content Production Pipeline
Maps
Create maps in Tiled.
Add collision and interaction object layers.
Export maps as JSON.
Load maps in Phaser.
Test collision and spawn points.
Add map IDs to zone configuration.
Characters
Create character concept.
Produce idle and walking sprites.
Create dialogue portrait.
Add NPC definition to npcs.json.
Add dialogue entries.
Place NPC in the correct map.
Quests
Define the quest objective.
Assign giver and recipient IDs.
Define required item and quantity.
Define Stamp and friendship rewards.
Add quest dialogue.
Test completion and failure prevention.
Data Validation
Build a validation script that checks:

Duplicate IDs
Missing item references
Missing NPC references
Invalid quest rewards
Dialogue entries without speakers
Missing asset paths
8. Recommended Development Order
Implement features in this order:

Project setup
Phaser boot and asset loading
Map rendering
Player movement
Collision
NPC interaction
Dialogue UI
Inventory state
Gathering
Quest acceptance
Quest delivery
Currency rewards
Friendship progression
Shop and upgrades
Save system
Mobile polish
Art and audio polish
Testing and deployment
Do not build large amounts of final content before the delivery loop is playable.

9. Quality Gates
Each milestone must pass its quality gate before the next phase begins.

Milestone	Quality Gate
Foundation	App builds and loads without errors
Movement	Player moves and collides correctly
Interaction	NPC dialogue works on desktop and mobile
Inventory	Items add, stack, and respect capacity
Quest Loop	One complete delivery can be finished
Progression	Rewards and upgrades affect the player
Persistence	Save data survives refresh
Polish	Critical path contains no placeholder assets
Release	MVP passes regression and device testing
10. Risks and Mitigation
Risk	Mitigation
Scope grows too quickly	Freeze MVP features before production
Art takes longer than expected	Use placeholders until mechanics are stable
Canvas UI becomes difficult to maintain	Keep menus and dialogue in HTML/CSS
Mobile support is delayed	Add touch controls during movement implementation
Save data becomes incompatible	Use versioned save data and migrations
Quest content contains broken references	Add automated content validation
Too much time goes into polish	Require the delivery loop to work first
Large assets slow loading	Compress files and load zones selectively
11. MVP Definition of Done
The MVP is complete when:

 The game is deployed to a public URL.
 A player can start a new game.
 A player can select and name an animal.
 The player can explore the post office and Bramble Patch.
 Keyboard and mobile controls work.
 The player can talk to all five NPCs.
 The player can gather resources.
 The player can accept and complete delivery quests.
 Stamps and friendship points update correctly.
 At least three upgrades can be purchased.
 Progress survives browser refresh.
 Settings and accessibility options work.
 The game runs at an acceptable frame rate on desktop and mobile.
 No critical-path placeholder content remains.
 Automated tests and manual playtests pass.
 There are no known blockers for a first public release.
12. First Playable Vertical Slice
Before building the full MVP, complete one polished mini-version containing:

One playable animal
One small map
One NPC
One gathering item
One delivery quest
One inventory screen
One Stamp reward
One friendship increase
One save/load cycle
One desktop control scheme
One mobile control scheme
This vertical slice proves that the core architecture works before expanding the world and content.