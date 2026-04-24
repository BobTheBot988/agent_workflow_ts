import { query } from "@qwen-code/sdk";

async function main() {
  // Single turn query - send a prompt and get the result
  const q = query({
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
