"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const sdk_1 = require("@qwen-code/sdk");
async function main() {
    // Single turn query - send a prompt and get the result
    const q = (0, sdk_1.query)({
        prompt: "Explain to me this project",
        options: {
            pathToQwenExecutable: "qwen",
        },
    });
    for await (const message of q) {
        if (message.type === "result" && message.subtype === "success") {
            console.log("Response:", message.result);
        }
    }
    console.log("Done!");
}
main().catch(console.error);
//# sourceMappingURL=index.js.map