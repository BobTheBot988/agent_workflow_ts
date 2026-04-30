import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import fs from 'fs';
import path from 'path';
import * as childProcess from 'child_process';

type AssistantContent = { type: 'text'; text: string };
type ContentBlock = AssistantContent | { type: 'thinking'; thinking: string };

function isAssistantContent(block: ContentBlock): block is AssistantContent {
  return (block as AssistantContent).type === 'text';
}

interface LogEntry {
  type: 'input' | 'output' | 'tool' | 'status' | 'error' | 'result';
  message: string;
  timestamp: Date;
}

interface TUIProps {
  prompt: string;
  srcPath: string;
  umlPath: string;
  invariantPath: string;
  moddableFiles: string[];
  onCompletion: (finalResponse: string) => void;
}

const maxIterations = 5;

export function TUI({
  prompt,
  srcPath,
  umlPath,
  invariantPath,
  moddableFiles,
  onCompletion,
}: TUIProps) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [iteration, setIteration] = useState(0);
  const [status, setStatus] = useState('Ready');

  const addLog = (type: LogEntry['type'], message: string) => {
    setLogs((prev) => [...prev, { type, message, timestamp: new Date() }]);
  };

  useEffect(() => {
    // Ink doesn't support scrollIntoView, logs will show newest at bottom
  }, [logs]);

  const runWorkflow = async () => {
    setIsRunning(true);
    setStatus('Starting...');

    addLog('status', `Workflow starting for: ${srcPath}`);

    try {
      const { query, createSdkMcpServer, tool } = await import('@qwen-code/sdk');
      const { z } = await import('zod');

      const buildFoundry = (projectDir: string): { success: boolean; output: string } => {
        try {
          const result = childProcess.execSync(`forge build -vvv 2>&1`, {
            encoding: 'utf-8',
            timeout: 600000,
            cwd: projectDir,
          });
          return { success: true, output: result };
        } catch (err: any) {
          if (err && err.code === 'ETIMEDOUT') {
            return { success: false, output: 'Foundry timeout' };
          }
          return {
            success: false,
            output: err?.stdout?.toString() || err?.message || String(err),
          };
        }
      };

      const foundryTool = tool(
        'foundry_compile',
        'build foundry projects',
        { project_dir: z.string() },
        async (args) => ({
          content: [{ type: 'text', text: String(buildFoundry(args.project_dir)) }],
        }),
      );

      const contractSkeleton = getContractSkeleton(path.dirname(srcPath));
      addLog('status', `Contract skeleton loaded (${contractSkeleton.length} chars)`);

      const umlContent = fs.readFileSync(umlPath);
      const invariantContent = fs.readFileSync(invariantPath, 'utf-8');

      const fullPrompt = `
Implement function bodies for this Solidity contract.

CONTRACT SKELETON DIRECTORY:
${srcPath}

MODIFIABLE FILES:
${moddableFiles.map((f) => `@${f}`).join('\n')}

UML/STATE MACHINE DESCRIPTION:
${umlContent}

FOUNDRY INVARIANTS:
${invariantContent}

REQUIREMENTS:
- Fill in ALL function bodies between { }
- Ensure all invariants hold after each function execution
- Use proper error handling (require/revert)
- No new functions or state variables
- Preserve exact existing structure
- Use foundry_compile tool to compile the project after modifications.

IMPORTANT: Use the file_editor tool to write your implementation to the moddable files.

Here is the contract skeleton for reference:
\`\`\`solidity
${contractSkeleton}
\`\`\`
`.trim();

      addLog('status', 'Starting LLM implementation...');
      setStatus('LLM Implementation');

      let fullResponse = '';
      const server = createSdkMcpServer({
        name: 'foundry_utils',
        tools: [foundryTool],
      });

      addLog('result', '```solidity\n// Implementing function bodies...\n```');

      for await (const message of query({
        prompt: fullPrompt,
        options: {
          pathToQwenExecutable: 'qwen',
          cwd: path.dirname(srcPath),
          permissionMode: 'auto-edit',
          mcpServers: { foundry_utils: server },
        },
      })) {
        if (message.type === 'assistant') {
          let content = '';
          if (Array.isArray(message.message.content)) {
            const firstBlock = message.message.content[0];
            if (firstBlock && 'text' in firstBlock) {
              content = firstBlock.text;
            } else if (firstBlock && 'thinking' in firstBlock) {
              content = firstBlock.thinking;
            }
          } else {
            content = String(message.message.content);
          }
          addLog('output', content);
          fullResponse += content;
        } else if (message.type === 'result') {
          const resultStr = typeof message.result === 'string' ? message.result : JSON.stringify(message.result);
          addLog('output', resultStr);
          fullResponse += resultStr;
        }
      }

      // Iterative verification loop
      for (let it = 1; it <= maxIterations; it++) {
        setIteration(it);
        addLog('status', `Verification iteration ${it}`);

        const contractDir = path.dirname(srcPath);
        addLog('status', 'Running Foundry fuzzing...');

        const foundryResult = runFoundryTest(contractDir);

        if (foundryResult.success) {
          addLog('result', '```solidity\n// ✓ Foundry tests passed!\n```');
          setStatus('✓ Completed');
          onCompletion(fullResponse);
          setIsRunning(false);
          return;
        } else {
          addLog('error', 'Foundry failed - refining...');
          setStatus(`Refining (iteration ${it}/${maxIterations})`);

          const refinementPrompt = `
Foundry fuzzing found errors. Fix the implementation.

Foundry Errors:
${foundryResult.output}

FIX:
- Identify exact failing test/case
- Fix implementation
- Return the corrected contract for display
`;

          const server = createSdkMcpServer({
            name: 'foundry_utils',
            tools: [foundryTool],
          });

          addLog('result', '```solidity\n// Refining based on errors...\n```');

          for await (const message of query({
            prompt: refinementPrompt,
            options: {
              pathToQwenExecutable: 'qwen',
              permissionMode: 'auto-edit',
              mcpServers: { foundry_utils: server },
            },
          })) {
            if (message.type === 'assistant') {
              let content = '';
              if (Array.isArray(message.message.content)) {
                const firstBlock = message.message.content[0];
                if (firstBlock && 'text' in firstBlock) {
                  content = firstBlock.text;
                } else if (firstBlock && 'thinking' in firstBlock) {
                  content = firstBlock.thinking;
                }
              } else {
                content = String(message.message.content);
              }
              addLog('output', content);
              fullResponse += content;
            } else if (message.type === 'result') {
              const resultStr = typeof message.result === 'string' ? message.result : JSON.stringify(message.result);
              addLog('output', resultStr);
              fullResponse += resultStr;
            }
          }

          if (it === maxIterations) {
            addLog('error', `Max iterations (${maxIterations}) reached`);
            setStatus('✗ Max iterations reached');
            onCompletion(fullResponse);
            setIsRunning(false);
            return;
          }
        }
      }
    } catch (err: any) {
      addLog('error', err.message || String(err));
      setStatus('✗ Error');
      setIsRunning(false);
    }
  };

  const runFoundryTest = (contractDir: string, fuzzRuns: number = 1000): any => {
    try {
      const result = childProcess.execSync(
        `forge test -vvv --fuzz-runs ${fuzzRuns}`,
        { encoding: 'utf-8', timeout: 600000, cwd: contractDir },
      );
      return { success: true, output: result };
    } catch (err: any) {
      if (err && err.code === 'ETIMEDOUT') {
        return { success: false, output: 'Foundry timeout' };
      }
      return {
        success: false,
        output: err?.stdout?.toString() || err?.message || String(err),
      };
    }
  };

  const getContractSkeleton = (dir: string): string => {
    const files = fs.readdirSync(dir);
    const solFiles = files.filter((f: string) => f.endsWith('.sol'));
    if (solFiles.length === 0) return '';
    return fs.readFileSync(path.join(dir, solFiles[0]), 'utf-8');
  };

  // Run workflow on mount
  useEffect(() => {
    runWorkflow();
  }, []);

  return (
    <Box
      flexDirection="column"
      height="100%"
      borderStyle="round"
      backgroundColor="#1a1a2e"
    >
      {/* Header */}
      <Box paddingX={1} paddingY={1}>
        <Text color="#00ffff" bold>
          SOLIDITY CODE IMPLEMENTATION WORKFLOW
        </Text>
        {isRunning && (
          <Text color="#ffd700" italic>
            {' '}Running: {status}
          </Text>
        )}
        {!isRunning && iteration === 0 && (
          <Text color="#32cd32" italic>
            {' '}Ready
          </Text>
        )}
        {iteration > 0 && (
          <Text color="#ff6347" italic>
            {' '}Iteration: {iteration}/{maxIterations}
          </Text>
        )}
      </Box>

      {/* Main content area */}
      <Box paddingX={1}>
        <Box paddingY={1} flexDirection="row">
          <Text color="gray">Source:</Text>
          <Box marginLeft={1}>
            <Text color="cyan">{srcPath}</Text>
          </Box>
        </Box>
        <Box paddingY={1} flexDirection="row">
          <Text color="gray">Moddable files:</Text>
          <Box marginLeft={1}>
            <Text color="cyan">{moddableFiles.join(', ')}</Text>
          </Box>
        </Box>
        {iteration > 0 && (
          <Box paddingY={1} flexDirection="row">
            <Text color="gray">Verification:</Text>
            <Box marginLeft={1}>
              <Text color="yellow">
                {isRunning ? 'Running...' : iteration === maxIterations ? 'Exceeded' : 'Passed'}
              </Text>
            </Box>
          </Box>
        )}
      </Box>

      {/* Logs area - Markdown renderer for code blocks */}
      <Box
        paddingX={1}
        borderColor="gray"
        borderStyle="single"
        flexDirection="column"
        maxHeight="30"
      >
        <Text color="gray">Output:</Text>
        <Box
          flexDirection="column"
          overflow="hidden"
        >
          {logs.map((log, idx) => (
            <Box key={log.timestamp.toISOString()} paddingY={1}>
              <Box paddingY={1} flexDirection="row">
                <Text color="gray">[{log.type.toUpperCase()}]</Text>
                <Box marginLeft={1}>
                  <Text color="gray">{log.timestamp.toLocaleTimeString()}</Text>
                </Box>
              </Box>
               {log.type === 'result' || log.type === 'output' ? (
                <Box>
                  {log.message.split('\n').map((line, i) => (
                    <Box key={i}>
                      {line.startsWith('```') ? (
                        <Text color="cyan" bold>{line}</Text>
                      ) : (
                        <Text>{line}</Text>
                      )}
                    </Box>
                  ))}
                </Box>
              ) : (
                <Text>{log.message}</Text>
              )}
            </Box>
          ))}
        </Box>
      </Box>

      {/* Footer */}
      <Box paddingX={1} paddingY={1} backgroundColor="#1a1a2e">
        <Text color="gray">Press Ctrl+C to cancel</Text>
      </Box>
    </Box>
  );
}
