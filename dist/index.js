import { z } from "zod";
import { createSdkMcpServer, query, tool } from "@qwen-code/sdk";
import * as child_process from "child_process";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
function build_foundry(project_dir) {
    try {
        const result = child_process.execSync(`forge build -vvv 2>&1`, {
            encoding: "utf-8",
            timeout: 600000,
            cwd: project_dir,
        });
        return { success: true, output: result };
    }
    catch (err) {
        if (err && err.code === "ETIMEDOUT") {
            return { success: false, output: "Foundry timeout" };
        }
        return {
            success: false,
            output: err?.stdout?.toString() || err?.message || String(err),
        };
    }
}
const foundryTool = tool("foundry_compile", "build foundry projects", { project_dir: z.string() }, async (args) => ({
    content: [
        {
            type: "text",
            text: String(build_foundry(args.project_dir)),
        },
    ],
}));
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
        return {
            success: false,
            output: err?.stdout?.toString() || err?.message || String(err),
        };
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
        return {
            success: false,
            output: err?.stdout?.toString() || err?.message || String(err),
        };
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
${srcPath}

MODIFIABLE FILES:
${moddableFiles.map((f) => `@${f}`).join("\n")}

UML/STATE MACHINE DESCRIPTION:
${fs.readFileSync(umlDescription)}

FOUNDRY INVARIANTS:
${fs.readFileSync(invariantPath, "utf-8")}

REQUIREMENTS:
- Fill in ALL function bodies between { }
- Ensure all invariants hold after each function execution
- Use proper error handling (require/revert)
- No new functions or state variables
- Preserve exact existing structure
- Run foundryTool to compile the project each time you actually modify the files.

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
    const server = createSdkMcpServer({
        name: "foundry_utils",
        tools: [foundryTool],
    });
    for await (const message of query({
        prompt,
        options: {
            pathToQwenExecutable: "qwen",
            cwd: srcPath,
            permissionMode: "auto-edit",
            mcpServers: {
                foundry_utils: server,
            },
        },
    })) {
        if (message.type === "assistant") {
            console.log("Assistant:", message.message.content);
        }
        else if (message.type === "result") {
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
            const server = createSdkMcpServer({
                name: "foundry_utils",
                tools: [foundryTool],
            });
            for await (const message of query({
                prompt: refinementPrompt,
                options: {
                    pathToQwenExecutable: "qwen",
                    permissionMode: "auto-edit",
                    mcpServers: {
                        foundry_utils: server,
                    },
                },
            })) {
                if (message.type === "assistant") {
                    console.log("Assistant:", message.message.content);
                }
                else if (message.type === "result") {
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
//# sourceMappingURL=index.js.map