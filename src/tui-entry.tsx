import { render } from 'ink';
import { TUI } from './tui.js';
import * as fs from 'fs';
import * as path from 'path';

const args = process.argv.slice(2);

if (args.length < 3) {
  console.error(
    'Usage: tsx src/tui-entry.tsx <src_path> <uml_path> <invariant_path> [moddable_files...]',
  );
  console.error(
    'Example: tsx src/tui-entry.tsx ./test/test3/src ./test/test3/auction3.xmi ./test/test3/test/ file1.sol file2.sol',
  );
  process.exit(1);
}

const srcPath = path.resolve(args[0]);
const umlDescription = args[1];
const invariantPath = args[2];
const moddableFiles = args.slice(3).map((f: string) => path.resolve(f));

if (moddableFiles.length === 0) {
  console.error('Error: No moddable files specified');
  process.exit(1);
}

const prompt = `Implement function bodies for the Solidity contract based on the provided UML diagram and invariants.`;

render(
  <TUI
    prompt={prompt}
    srcPath={srcPath}
    umlPath={umlDescription}
    invariantPath={invariantPath}
    moddableFiles={moddableFiles}
    onCompletion={(finalResponse) => {
      console.log('\nImplementation complete.');
      console.log('Final response length:', finalResponse.length);
    }}
  />,
);
