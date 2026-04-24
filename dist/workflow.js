"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const sdk_1 = require("@qwen-code/sdk");
const child_process = __importStar(require("child_process"));
const dotenv = __importStar(require("dotenv"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// Load .qwen/.env file
const envPath = path.join(__dirname, "..", ".qwen", ".env");
if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
}
dotenv.config();
function runHalmos(srcPath) {
    try {
        const result = child_process.execSync(`halmos "${srcPath}" --max-width 100 --max-depth 100 --solver-threads 16`, { encoding: "utf-8", timeout: 300000 });
        return { success: true, output: result };
    }
    catch (err) {
        if (err && err.code === "ETIMEDOUT") {
            return { success: false, output: "Halmos timeout (running >5min)" };
        }
        return { success: false, output: err?.stdout?.toString() || err?.message || String(err) };
    }
}
function runFoundryTest(contractDir, fuzzRuns = 1000) {
    try {
        const result = child_process.execSync(`forge test -vvv --fuzz-runs ${fuzzRuns}`, { encoding: "utf-8", timeout: 600000, cwd: contractDir });
        return { success: true, output: result };
    }
    catch (err) {
        if (err && err.code === "ETIMEDOUT") {
            return { success: false, output: "Foundry timeout" };
        }
        return { success: false, output: err?.stdout?.toString() || err?.message || String(err) };
    }
}
function getContractSkeleton(dir) {
    const files = fs.readdirSync(dir);
    const solFiles = files.filter((f) => f.endsWith(".sol"));
    if (solFiles.length === 0)
        return "";
    return fs.readFileSync(path.join(dir, solFiles[0]), "utf-8");
}
async function main() {
    const args = process.argv.slice(2);
    if (args.length < 3) {
        console.error("Usage: ts-node src/workflow.ts <src_path> <uml_path> <invariant_path> [moddable_files...]");
        console.error("Example: ts-node src/workflow.ts ./test/test3/src ./test/test3/auction3.xmi ./test/test3/test/ file1.sol file2.sol");
        process.exit(1);
    }
    const srcPath = path.resolve(args[0]);
    const umlDescription = args[1];
    const invariantPath = args[2];
    const moddableFiles = args.slice(3).map((f) => path.resolve(f));
    if (moddableFiles.length === 0) {
        console.error("Error: No moddable files specified");
        process.exit(1);
    }
    const contractSkeleton = getContractSkeleton(path.dirname(srcPath));
    // Build the system prompt
    const systemPrompt = `
You have a 'writer' tool. To use it:
1. Read the file first to get the exact content.
2. Identify a unique 'search_block' that needs changing.
3. Provide the 'replace_block' with your improvements.
Do not guess the content; use the current file text for the search_block.
  `.trim();
    console.log("=".repeat(60));
    console.log("SOLIDITY CODE IMPLEMENTATION WORKFLOW");
    console.log("=".repeat(60));
    console.log("\nInput required:");
    console.log("  - Contract skeleton (.sol)");
    console.log("  - PlantUML diagram (or description)");
    console.log("  - Foundry invariants (human-written)");
    console.log("\nOutput:");
    console.log("  - Implemented function bodies");
    console.log("  - Halmos + Foundry verification results");
    console.log("  - Iterative refinement on errors");
    // Build the prompt
    const prompt = `
Implement function bodies for this Solidity contract.

CONTRACT SKELETON DIRECTORY:
${path.dirname(srcPath)}

MODIFIABLE FILES:
${moddableFiles.map((f) => `@${f}`).join("\n")}

UML/STATE MACHINE DESCRIPTION:
${umlDescription}

FOUNDRY INVARIANTS:
${fs.readFileSync(invariantPath, "utf-8")}

REQUIREMENTS:
- Fill in ALL function bodies between { }
- Ensure all invariants hold after each function execution
- Use proper error handling (require/revert)
- No new functions or state variables
- Preserve exact existing structure

IMPORTANT: Use the file_editor tool to write your implementation to the moddable files.
This will save your work so it can be verified with Foundry tests.

Here is the contract skeleton for reference:
\`\`\`solidity
${contractSkeleton}
\`\`\`
`.trim();
    console.log("\n" + "-".repeat(60));
    console.log("STEP 1: LLM implements function bodies");
    console.log("-".repeat(60));
    // Run the agent
    let fullResponse = "";
    for await (const message of (0, sdk_1.query)({
        prompt,
        options: {
            systemPrompt,
            pathToQwenExecutable: "qwen",
        },
    })) {
        if (message.type === "result" && message.subtype === "success") {
            fullResponse += message.result;
            console.log(message.result, { stream: true });
        }
    }
    process.stdin.resume();
    await new Promise((resolve) => process.stdin.on("data", () => resolve()));
    console.log("\nImplementation complete.");
    // Iterative verification loop
    const maxIterations = 5;
    for (let iteration = 1; iteration <= maxIterations; iteration++) {
        console.log(`\n${"=".repeat(60)}`);
        console.log(`VERIFICATION ITERATION ${iteration}`);
        console.log("=".repeat(60));
        console.log("\n[1/2] Running Foundry fuzzing...");
        const contractDir = path.dirname(srcPath);
        const foundryResult = runFoundryTest(contractDir);
        if (foundryResult.success) {
            console.log("✓ Foundry tests passed");
            return;
        }
        else {
            console.log("✗ Foundry failed:");
            console.log("\n[Foundry Output]");
            const lines = foundryResult.output.split("\n");
            if (lines.length > 50) {
                console.log(`[... ${lines.length - 50} lines truncated ...]`);
                console.log(lines.slice(-50).join("\n"));
            }
            else {
                console.log(foundryResult.output);
            }
            console.log("[End of Foundry Output]\n");
            console.log("\nSending errors to LLM for refinement...");
            const refinementPrompt = `
Foundry fuzzing found errors. Fix the implementation.

Foundry Errors:
${foundryResult.output}

FIX:
- Identify exact failing test/case
- Fix implementation
- Return the corrected contract for display
`;
            fullResponse = "";
            for await (const message of (0, sdk_1.query)({
                prompt: refinementPrompt,
                options: {
                    systemPrompt,
                    pathToQwenExecutable: "qwen",
                },
            })) {
                if (message.type === "result" && message.subtype === "success") {
                    fullResponse += message.result;
                    console.log(message.result, { stream: true });
                }
            }
            process.stdin.resume();
            await new Promise((resolve) => process.stdin.on("data", () => resolve()));
            if (iteration === maxIterations) {
                console.log(`\n✗ Max iterations (${maxIterations}) reached.`);
                return;
            }
        }
    }
}
main().catch(console.error);
//# sourceMappingURL=workflow.js.map