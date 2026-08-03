import Phaser from "phaser";
import "./styles/global.css";
import "./styles/game-ui.css";
import { gameConfig } from "./game/GameConfig.ts";
import { initErrorLogging } from "./game/ErrorLog.ts";

initErrorLogging();

// Exposed on window for debugging during development.
type GameWindow = Window & { game?: Phaser.Game };
(window as GameWindow).game = new Phaser.Game(gameConfig);
