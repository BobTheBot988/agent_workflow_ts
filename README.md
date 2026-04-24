# Qwen Code SDK Project

This project demonstrates how to use the `@qwen-code/sdk` TypeScript SDK to programmatically access the Qwen Code CLI.

## Setup

```bash
npm install
npm run build
```

## Usage

Run the example:

```bash
npm start
```

The example performs a single-turn query using the Qwen Code CLI located at `/home/robertodr/.npm-global/bin/qwen`.

## Key Points

- The SDK exports a `query()` function (not a `QwenClient` class)
- Use `pathToQwenExecutable` option to specify your qwen binary path
- The SDK supports both single-turn and multi-turn queries via async iteration
- Check the type definitions at `node_modules/@qwen-code/sdk/dist/index.d.ts` for full API documentation
