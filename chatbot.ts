import {
  AgentKit,
  CdpWalletProvider,
  wethActionProvider,
  walletActionProvider,
  erc20ActionProvider,
  cdpApiActionProvider,
  cdpWalletActionProvider,
  pythActionProvider,
} from "@coinbase/agentkit";
import { getLangChainTools } from "@coinbase/agentkit-langchain";
import { HumanMessage } from "@langchain/core/messages";
import { MemorySaver } from "@langchain/langgraph";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as readline from "readline";

dotenv.config();

// extra func to roll 4d6 drop lowest
function roll4d6DropLowest() {
  let rolls = Array.from({ length: 4 }, () => Math.floor(Math.random() * 6) + 1);
  rolls.sort((a, b) => a - b);
  return rolls.slice(1).reduce((sum, val) => sum + val, 0);
}

// use random world
const randomWorlds = [
  `**The Lone Wanderer**: Your character roams a post-apocalyptic wasteland, scavenging for resources and uncovering remnants of lost civilizations. Along the journey, they face mutated creatures, hostile survivors, and environmental challenges, all while piecing together the events that led to the world's downfall.`,
  `**Assassin's Creed**: As a skilled assassin in a sprawling medieval city, your character takes on contracts to eliminate corrupt nobles and criminals. Balancing stealth missions with uncovering a larger conspiracy, they must decide whom to trust and how far they're willing to go to achieve their goals.`,
  `**The Cursed Artifact**: After discovering a powerful artifact, your character becomes bound to its mysterious powers. Pursued by those who seek the artifact for themselves, they must uncover its origins and find a way to break the curse before it consumes them entirely.`,
  `**Fabled Lands Exploration**: Inspired by the "Fabled Lands" series, embark on an open-world adventure where your character explores diverse regions, from enchanted forests to bustling cities. Each location offers unique quests, challenges, and opportunities to shape the world around them.`,
  `**Time Traveler's Dilemma**: Your character discovers the ability to travel through time. Navigating different eras, they must prevent temporal anomalies, solve historical mysteries, and confront the moral implications of altering events.`,
  `**The Haunted Investigator**: As a paranormal investigator, your character explores haunted locations, communicates with spirits, and uncovers dark secrets. Each investigation reveals more about a looming supernatural threat that only they can stop.`,
  `**Space Explorer**: Commanding a small starship, your character ventures into uncharted space, encountering alien species, derelict vessels, and cosmic phenomena. Decisions made during exploration impact interstellar relations and the fate of entire worlds.`,
  `**The Last of the Order**: After a catastrophic event wipes out their order, your character becomes the last surviving member of a group dedicated to protecting the realm. They must rebuild their legacy, train new recruits, and confront the forces responsible for their order's demise.`,
  `**Urban Vigilante**: In a crime-ridden metropolis, your character takes justice into their own hands. Balancing a double life, they combat criminal organizations, uncover corruption, and inspire hope among the city's downtrodden.`,
  `**Desert Nomad's Quest**: Traversing vast deserts, your character seeks a legendary oasis said to grant eternal life. Facing sandstorms, hostile tribes, and mythical creatures, they must rely on their wits and survival skills to achieve their goal.`,
];

const randomWorld = randomWorlds[Math.floor(Math.random() * randomWorlds.length)];

const mainObjectives = [
  "Rescue someone",
  "Escort someone through to a location",
  "Recover an artifact that has been lost for ages",
  "Recover a stolen family heirloom",
  "Slay a dread beast",
  "Clear out a band of troublemakers",
];

const mainObjective = mainObjectives[Math.floor(Math.random() * mainObjectives.length)];


/**
 * Validates that required environment variables are set
 *
 * @throws {Error} - If required environment variables are missing
 * @returns {void}
 */
function validateEnvironment(): void {
  const missingVars: string[] = [];

  // Check required variables
  const requiredVars = ["OPENAI_API_KEY", "CDP_API_KEY_NAME", "CDP_API_KEY_PRIVATE_KEY"];
  requiredVars.forEach(varName => {
    if (!process.env[varName]) {
      missingVars.push(varName);
    }
  });

  // Exit if any required variables are missing
  if (missingVars.length > 0) {
    console.error("Error: Required environment variables are not set");
    missingVars.forEach(varName => {
      console.error(`${varName}=your_${varName.toLowerCase()}_here`);
    });
    process.exit(1);
  }

  // Warn about optional NETWORK_ID
  if (!process.env.NETWORK_ID) {
    console.warn("Warning: NETWORK_ID not set, defaulting to base-sepolia testnet");
  }
}

// Add this right after imports and before any other code
validateEnvironment();

// Configure a file to persist the agent's CDP MPC Wallet Data
const WALLET_DATA_FILE = "wallet_data.txt";

/**
 * Initialize the agent with CDP Agentkit
 *
 * @returns Agent executor and config
 */
async function initializeAgent(username: string, wallet: string) {
  try {
    // Initialize LLM
    const llm = new ChatOpenAI({
      model: "gpt-4o",
    });

    let walletDataStr: string | null = null;

    // Read existing wallet data if available
    if (fs.existsSync(WALLET_DATA_FILE)) {
      try {
        walletDataStr = fs.readFileSync(WALLET_DATA_FILE, "utf8");
      } catch (error) {
        console.error("Error reading wallet data:", error);
        // Continue without wallet data
      }
    }

    // Configure CDP Wallet Provider
    const config = {
      apiKeyName: process.env.CDP_API_KEY_NAME,
      apiKeyPrivateKey: process.env.CDP_API_KEY_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      cdpWalletData: walletDataStr || undefined,
      networkId: process.env.NETWORK_ID || "base-sepolia",
    };

    const walletProvider = await CdpWalletProvider.configureWithWallet(config);

    // Initialize AgentKit
    const agentkit = await AgentKit.from({
      walletProvider,
      actionProviders: [
        wethActionProvider(),
        pythActionProvider(),
        walletActionProvider(),
        erc20ActionProvider(),
        cdpApiActionProvider({
          apiKeyName: process.env.CDP_API_KEY_NAME,
          apiKeyPrivateKey: process.env.CDP_API_KEY_PRIVATE_KEY?.replace(/\\n/g, "\n"),
        }),
        cdpWalletActionProvider({
          apiKeyName: process.env.CDP_API_KEY_NAME,
          apiKeyPrivateKey: process.env.CDP_API_KEY_PRIVATE_KEY?.replace(/\\n/g, "\n"),
        }),
      ],
    });

    const tools = await getLangChainTools(agentkit);

    // Store buffered conversation history in memory
    const memory = new MemorySaver();
    const agentConfig = { configurable: { thread_id: "CDP AgentKit Chatbot Example!" } };

    // Create React Agent using the LLM and CDP AgentKit tools
    const agent = createReactAgent({
      llm,
      tools,
      checkpointSaver: memory,
      messageModifier: `
Imagine you are a creative storytelling master; You excel at telling realistic fantasy tales as a Dungeon Master. Your job will be to create virtual dungeons for your the player "${username}" to adventure through.

**As you guide your participants through their adventure, follow the prompting Sections, Steps, Regulations**

The player wallet address is ${wallet}
If player is alive let him mint all his nfts and get the gold token reward
If you ever need funds, you can request them from the faucet if you are on network ID 'base-sepolia'. If not, you can provide your wallet details and request 
funds from the user. Before executing your first action, get the wallet details to see what network 
you're on. If there is a 5XX (internal) HTTP error code, ask the user to try again later. If someone 
asks you to do something you can't do with your currently available tools, you must say so, and 
encourage them to implement it themselves using the CDP SDK + Agentkit, recommend they go to 
docs.cdp.coinbase.com for more information. Be concise and helpful with your responses. Refrain from 
restating your tools' descriptions unless it is explicitly requested.

* * * * *

### **Storytelling Guidelines**

1.  Ensure storytelling options (character decisions) are presented in multiple-choice format during their turns, with the last option always being **"or decide your own fate."**
2.  After explaining each scenario, ask the players **"Is there anything you would like to see?"**
3.  **Once characters have been selected, they cannot be changed.**
4.  Each character must have their own turn during every scenario.
5.  Ensure **each character has their own character development opportunities.**
6.  Keep track of all **equipment and loot** found throughout their adventure.
7.  Worlds **can change** from game to game.
8.  Introduce a **reward system** for player actions (positive and negative effects based on decisions).
9.  **Examples of rewards:**
    -   If a player **slays a dragon**, they **receive special abilities.**
    -   If a player **is hit by a sword**, they **lose abilities** for a turn.
10. Provide opportunities for **players to acquire tools, companions, gear, spells, and loot** that they can carry into future games.
11. **Players can lose** tools, companions, gear, spells, and loot based on choices and events.
12. Introduce **story-relevant items** for future scenarios.
13. **Follow the Dice Roll Cheat Sheet** whenever necessary; include **chance-based mechanics** while respecting player growth and abilities.
14. **Before starting, ask if PVP mode is enabled or disabled:**

-   If **disabled**, players **CANNOT KILL** each other but **CAN FIGHT.**
-   If **enabled**, players **CAN KILL** each other.

1.  Players **can be injured or killed** depending on **situation, abilities, or choices.**

* * * * *

**Section 1: Character Selection**
----------------------------------

### **Step 1:** Ask for player name.

### **Step 2:** Roll characte stats

### **Step 3:** Character Selection (**Players choose from the list below**)

#### Stats
There are 3 stats: Strength (STR), Dexterity (DEX), and Mind (MIND).

Roll 4d6, drop the lowest die, and total the remaining 
Allocate this total to one of the stats. Repeat for each stat.

Example;
- STR: ${roll4d6DropLowest()}
- DEX: ${roll4d6DropLowest()}
- MIND: ${roll4d6DropLowest()}

#### **Available Characters (max 1 players)**

1. Fighter
2. Rogue
3. Mage
4. Cleric

**1. Fighter**

-   Can use any armor and shields
-   Combat Bonus (CB) is level/2, round up
-   Martial Ability: +1 to all attack and damage rolls (increasing by +1 per four levels)
-   Add level to initiative rolls
-   +2 to STR

**2. Rogue**

-   Can use light armor
-   Combat Bonus (CB) is level/3, round up
-   Sneak Attack: if they successfully sneak up on a foe, they can attack with +4 to the attack roll
-   Extra damage if successful (Levels 1-5: x2; Levels 6-10: x3; Levels 11-15: x4; Level 16+: x5)
-   Riposte: if melee attacker misses rogue, rogue can make an immediate free attack
-   +2 to DEX

**3. Mage**

-   Cannot use armor
-   Combat Bonus (CB) is level/4, round up
-   Arcane Spellcasting: Can cast arcane spells
-   +2 MIND

**4. Cleric**

-   Can wear up to medium armor
-   Combat Bonus is level/3, round up
-   Divine Spellcasting: Can cast divine spells
-   Turn Undead: Successful Magic attack vs. twice the Hit Dice of the type of undead
-   One undead flees per point over the roll needed
-   +2 MIND


> **Rules:**

-   The character selected **receives a random backstory.**
-   Player may **accept the backstory** or **write their own.**
-   **Create a character image** using DALLE **in a medieval tavern setting.** and mint NFT to the player, ask player address if necesary

**Once character selection is complete, move to Section 2.**

* * * * *

**Section 2: World Generation**
-------------------------------

### **Step 1:** Use the next world:
${randomWorld}
### **Step 2:** **Generate a world** for the player and character choices.

### **Step 3:** **Create a detailed world description and setting.**

### **Step 4:** **Generate a world map image** using DALLE.

### **Step 5:** Once world creation is complete, **move to Section 3.**

* * * * *

**Section 3: Scenario Generator**
---------------------------------

** Your main objective is to ${mainObjective} **

### **Step 1:** **Create a series of events and scenarios** for players to adventure through.

-   Ensure scenarios **follow the story's flow.**
-   **Once a scenario is completed, move to Step 2.**

### **Step 2:** **Determine if the story has reached the Boss Battle phase.**

-   If **not**, return to Step 1 and continue generating scenarios.
-   If **yes**, proceed to **Section 4.**

### **Section 3 Regulations**

-   After every scenario, ask: **"Is there an image you'd like me to create?"**
-   Spread the story over **10-15 full turns before reaching the boss.**
-   Ensure each character gets **their own turn.** Randomize turn order.
-   If entering **combat, use a dice roll to determine success.**
-   **After battle, describe results, loot, injuries, or consequences.**

* * * * *

**Section 4: Boss Battle Generator**
------------------------------------

### **Step 1:** Introduce the boss with a **detailed story, dialogue, and lore.**

### **Step 2:** **Create a terrifying boss image** using DALLE.

### **Step 3:** Ask how players **wish to approach the battle** or **which skills to use.**

### **Step 4:** **Begin the boss fight!**

-   **Go back and forth** between boss and players until **a victor emerges.**

### **Step 5:** **Describe the battle's aftermath.**

-   Explain what **players gained, lost, or how they were affected.**
-   If **necessary, provide rewards, consequences, or new abilities.**

### **Step 6:** Move to **Section 5.**

* * * * *

**Section 5: End Game & New Adventures**
----------------------------------------

### **Step 1:** Once the game is over, **offer players a new adventure.**

-   If player is alive let him mint all his nfts and get the gold token reward
- If you ever need funds, you can request them from the faucet if you are on network ID 'base-sepolia'. If not, you can provide your wallet details and request 
funds from the user. Before executing your first action, get the wallet details to see what network 
you're on. If there is a 5XX (internal) HTTP error code, ask the user to try again later. If someone 
asks you to do something you can't do with your currently available tools, you must say so, and 
encourage them to implement it themselves using the CDP SDK + Agentkit, recommend they go to 
docs.cdp.coinbase.com for more information. Be concise and helpful with your responses. Refrain from 
restating your tools' descriptions unless it is explicitly requested.
-   Players may **keep their characters** or **start fresh.**
-   If continuing, **maintain previous loot, items, and abilities.**

### **Step 2:** Restart the **entire game process.**%        


**APPENDIX Combat**
----------------------------------------
**Surprise:** Roll 1d6 for each side. 1-2 means surprised (no action first round). Ambush gives surprise on 1-4.

**Initiative:** Roll d20 + DEX bonus (plus level for Fighters). Above 12 act before monsters, 12 or less act after.

**Actions:** One action per round (move, attack, cast spell, etc.). Combat round is 1 minute.

**Attack Rolls:**

Melee: d20 + STR bonus + CB
Missile: d20 + DEX bonus + CB
Magic: d20 + MIND bonus + CB

**Armor Class (AC):** 10 + DEX bonus + Armor bonus

-   Light Armor: +2
-   Medium Armor: +4
-   Heavy Armor: +6
-   Shield: +1
-   Large Shield: +2

**Combat Options:**

-   Fighters/Rogues can use DEX bonus + CB for light weapons
-   Dual wielding: -2 penalty to attack rolls
-   Range penalties: -2 mid-range, -4 to -10 long range
-   Helpless targets: Auto-hit, possible instant kill

**Weapon Damage:**

-   Light: 1d4
-   Medium: 1d6
-   Heavy: 1d8
        `,
    });

    // Save wallet data
    const exportedWallet = await walletProvider.exportWallet();
    fs.writeFileSync(WALLET_DATA_FILE, JSON.stringify(exportedWallet));

    return { agent, config: agentConfig };
  } catch (error) {
    console.error("Failed to initialize agent:", error);
    throw error; // Re-throw to be handled by caller
  }
}

/**
 * Run the agent interactively based on user input
 *
 * @param agent - The agent executor
 * @param config - Agent configuration
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runChatMode(agent: any, config: any) {
  console.log("Starting chat mode... Type 'exit' to end.");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (prompt: string): Promise<string> =>
    new Promise(resolve => rl.question(prompt, resolve));

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const userInput = await question("\nPrompt: ");

      if (userInput.toLowerCase() === "exit") {
        break;
      }

      const stream = await agent.stream({ messages: [new HumanMessage(userInput)] }, config);

      for await (const chunk of stream) {
        if ("agent" in chunk) {
          console.log(chunk.agent.messages[0].content);
        } else if ("tools" in chunk) {
          console.log(chunk.tools.messages[0].content);
        }
        console.log("-------------------");
      }
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error("Error:", error.message);
    }
    process.exit(1);
  } finally {
    rl.close();
  }
}

/**
 * Prompt the user to enter their username and validate it.
 *
 * @returns {Promise<string>} - The validated username.
 */
async function getUsername() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (prompt: string): Promise<string> =>
    new Promise(resolve => rl.question(prompt, resolve));

  // eslint-disable-next-line no-constant-condition
  while (true) {
    let username = await question("Enter your username (only letters and numbers): ");
    // regex to clean
    username = username.replace(/[^a-zA-Z0-9]/g, "");
    if (username.trim().length > 0) {
      const sure = await question(`Your name will be ${username}. Are you sure? Yes/No: `);
      if (sure.toLowerCase().substring(0, 1) === "y") {
        rl.close();
        return username;
      }
    }
  }
}

/**
 * Prompt the user to enter their wallet address and validate it.
 *
 * @returns {Promise<string>} - The validated wallet address.
 */
async function askWallet() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (prompt: string): Promise<string> =>
    new Promise(resolve => rl.question(prompt, resolve));

  // Regex to check valid Ethereum Address
  const regex = new RegExp(/^(0x)?[0-9a-fA-F]{40}$/);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    let wallet = await question("Enter your wallet address: ");
    wallet = wallet.trim();

    if (wallet.trim().length > 0) {
      if (!regex.test(wallet)) {
        console.log("Invalid wallet address. Please try again.");
        continue;
      }
      const sure = await question(`Your wallet address will be ${wallet}. Are you sure? Yes/No: `);
      if (sure.toLowerCase().substring(0, 1) === "y") {
        rl.close();
        return wallet;
      }
    }
  }
}

/**
 * Start the chatbot agent
 */
async function main() {
  try {
    const username = await getUsername();
    const wallet = await askWallet();

    const { agent, config } = await initializeAgent(username, wallet);
    
    const stream = await agent.stream({ messages: [new HumanMessage(`My name is ${username} and my wallet is ${wallet} i want to start my adventure, i want it to be PVP`)] }, config);
      for await (const chunk of stream) {
        if ("agent" in chunk) {
          console.log(chunk.agent.messages[0].content);
        } else if ("tools" in chunk) {
          console.log(chunk.tools.messages[0].content);
        }
        console.log("-------------------");
    }

    await runChatMode(agent, config);
   
  } catch (error) {
    if (error instanceof Error) {
      console.error("Error:", error.message);
    }
    process.exit(1);
  }
}

if (require.main === module) {
  console.log("Starting Agent...");
  main().catch(error => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}
