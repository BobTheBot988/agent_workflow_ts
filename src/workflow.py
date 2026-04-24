from qwen_agent.agents.doc_qa.parallel_doc_qa_member import SYSTEM_PROMPT_TEMPLATE_EN
from qwen_agent.agents import Assistant
from qwen_agent.utils.output_beautify import typewriter_print
import subprocess
import os
import sys
import dotenv
from pprint import pprint
from writertool import Writer
import qwen_agent.tools

# Load .qwen/.env file to get API configuration
env_path = os.path.join(os.path.dirname(__file__), "..", ".qwen", ".env")
if os.path.exists(env_path):
    dotenv.load_dotenv(env_path)

# Also check current directory for .env
dotenv.load_dotenv(override=True)


def run_halmos(src_path: str) -> tuple[bool, str]:
    """Run Halmos SMT solver on contract. Returns (success, output)."""
    try:
        result = subprocess.run(
            [
                "halmos",
                src_path,
                "--max-width",
                "100",
                "--max-depth",
                "100",
                "--solver-threads 16",
            ],
            capture_output=True,
            text=True,
            timeout=300,
        )
        return result.returncode == 0, result.stdout + result.stderr
    except subprocess.TimeoutExpired:
        return False, "Halmos timeout (running >5min)"
    except Exception as e:
        return False, str(e)


def run_foundry_test(contract_dir: str, fuzz_runs: int = 1_000) -> tuple[bool, str]:
    """Run Foundry tests for fuzzing. Returns (success, output)."""
    try:
        result = subprocess.run(
            ["forge", "test", "-vvv", "--fuzz-runs", str(fuzz_runs)],
            capture_output=True,
            text=True,
            cwd=contract_dir,
            timeout=600,
        )
        return result.returncode == 0, result.stdout + result.stderr
    except subprocess.TimeoutExpired:
        return False, "Foundry timeout"
    except Exception as e:
        return False, str(e)


def main():
    """
    Solidity development workflow:
    1. Umbrello generates UML → skeleton (handled separately)
    2. Human writes Foundry invariants
    3. LLM implements function bodies from UML + invariants
    4. Verify with Halmos (Z3) + Foundry fuzzing
    4a. On failure, report errors back to LLM for refinement
    5. Human final review
    """

    SYSTEM_PROMPT = """
        You have a 'writer' tool. To use it:
        1. Read the file first to get the exact content.
        2. Identify a unique 'search_block' that needs changing. 
        3. Provide the 'replace_block' with your improvements.
        Do not guess the content; use the current file text for the search_block.
    """.strip()
    # skills for the agent to use
    skills = [
        f"/home/robertodr/gits/agent_workflow/.qwen/skills/{skill}/SKILL.md"
        for skill in [
            "setup-solidity-contracts",
            "develop-secure-contracts",
            "upgrade-solidity-contracts",
        ]
    ]

    # tools for the agent to use

    # Initialize LLM agent for code implementation
    # Uses env vars OPENAI_API_KEY and OPENAI_BASE_URL
    # Force OpenAI-compatible mode with model_server
    agent = Assistant(
        llm={
            "model": "mudler/Qwen3-Coder-Next-APEX-GGUF",
            "model_server": "http://127.0.0.1:8080/v1",
            "model_type": "oai",
        },
        system_message=SYSTEM_PROMPT,
        files=skills,
        function_list=[
            "code_interpreter",
            "writer",
            # "retrieval",
        ],
    )
    writer: Writer = agent.function_map["writer"]

    pprint("=" * 60)
    pprint("SOLIDITY CODE IMPLEMENTATION WORKFLOW")
    pprint("=" * 60)
    pprint("\nInput required:")
    pprint("  - Contract skeleton (.sol)")
    pprint("  - PlantUML diagram (or description)")
    pprint("  - Foundry invariants (human-written)")
    pprint("\nOutput:")
    pprint("  - Implemented function bodies")
    pprint("  - Halmos + Foundry verification results")
    pprint("  - Iterative refinement on errors")

    # Workflow loop - read from CLI arguments
    if len(sys.argv) == 5:
        pprint(
            "Usage: uv run workflow.py <src_path> <uml_path> <invariant_path> -m[...]"
        )
        pprint(
            "Example: uv run workflow.py ./test/test3/src ./test/test3/auction3.xmi ./test/test3/test/"
        )
        sys.exit(1)

    src_path = sys.argv[1].strip()
    uml_description = sys.argv[2].strip()
    invariant_path = sys.argv[3].strip()

    if sys.argv[4] == "-m":
        moddable_files = sys.argv[5:]
        writer.add_mod_files(moddable_files)
    else:
        pprint("Suca coglione non hai messo file da modificare.")
        exit(1)

    pprint("\n" + "-" * 60)
    pprint("STEP 1: LLM implements function bodies")
    pprint("-" * 60)

    # - Follow state transitions from UML description
    prompt = f"""
    Implement function bodies for this Solidity contract.

    CONTRACT SKELETON DIRECTORY:
    @{src_path}
    
    MODIFIABLE FILES:
    {moddable_files}

    UML/STATE MACHINE DESCRIPTION:
    @{uml_description}

    FOUNDRY INVARIANTS:
    @{invariant_path}

    REQUIREMENTS:
    - Fill in ALL function bodies between {{ }}
    - Ensure all invariants hold after each function execution
    - Use proper error handling (require/revert)
    - No new functions or state variables
    - Preserve exact existing structure

    IMPORTANT: Use the file_editor tool to write your implementation to: {src_path}
    This will save your work so it can be verified with Foundry tests.
    """

    # Extract and pprint the response content cleanly
    response_text = ""
    response = []
    for response in agent.run([{"role": "user", "content": prompt}]):
        response_text = typewriter_print(response, response_text)  # type: ignore
    input("\nPress to continue:")
    pprint("\nImplementation complete.")

    # Iterative verification loop
    max_iterations = 5
    for iteration in range(1, max_iterations + 1):
        pprint(f"\n{'=' * 60}")
        pprint(f"VERIFICATION ITERATION {iteration}")
        pprint("=" * 60)

        # Run Foundry
        pprint("\n[1/2] Running Foundry fuzzing...")
        contract_dir = os.path.dirname(os.path.abspath(src_path))
        foundry_success, foundry_output = run_foundry_test(contract_dir)

        if foundry_success:
            pprint("✓ Foundry tests passed")
            return
        else:
            pprint("✗ Foundry failed:")
            pprint("\n[Foundry Output]")
            # Limit output for readability - show last 50 lines
            lines = foundry_output.split("\n")
            if len(lines) > 50:
                pprint(f"[... {len(lines) - 50} lines truncated ...]")
                pprint("\n".join(lines[-50:]))
            else:
                pprint(foundry_output)
            pprint("[End of Foundry Output]\n")

            # Refine with LLM
            pprint("\nSending errors to LLM for refinement...")
            refinement_prompt = f"""
            Foundry fuzzing found errors. Fix the implementation.

            Foundry Errors:
            {foundry_output}

            FIX:
            - Identify exact failing test/case
            - Fix implementation
            - Use file_editor to write the corrected contract to: {src_path}
            - Return the corrected contract for display
            """

            # Extract and pprint the refined response cleanly
            response = []
            response_text = ""
            for response in agent.run([{"role": "user", "content": refinement_prompt}]):
                response_text = typewriter_print(response, response_text)  # type: ignore
            input("\n Press to continue:")

            if iteration == max_iterations:
                pprint(f"\n✗ Max iterations ({max_iterations}) reached.")
                return

        # Run Halmos
        # pprint("\n[2/2] Running Halmos (Z3 SMT solver)...")
        # halmos_success, halmos_output = run_halmos(impl_path)
        #
        # if halmos_success:
        #     pprint("✓ Halmos passed")
        # else:
        #     pprint("✗ Halmos failed:")
        #     pprint(halmos_output)
        #
        #     # Refine with LLM
        #     pprint("\nSending errors to LLM for refinement...")
        #     refinement_prompt = f"""
        #     Halmos found errors. Fix the implementation.
        #
        #     ORIGINAL CONTRACT:
        #     {contract_code}
        #
        #     CURRENT IMPLEMENTATION:
        #     {implemented_code}
        #
        #     Halmos Errors:
        #     {halmos_output}
        #
        #     UML DESCRIPTION:
        #     {uml_description}
        #
        #     INVARIANTS:
        #     {invariants}
        #
        #     FIX:
        #     - Identify exact line causing error
        #     - Fix implementation to satisfy all constraints
        #     - Return ONLY the corrected contract
        #     """
        #
        #     response = agent.run(refinement_prompt, stream=False)
        #     implemented_code = response[-1]["content"] if response else implemented_code
        #
        #     if iteration == max_iterations:
        #         pprint(
        #             f"\n✗ Max iterations ({max_iterations}) reached. Manual review required."
        #         )
        #     continue
        #
        # # Both passed
        # if halmos_success and foundry_success:
        #     pprint("\n" + "=" * 60)
        #     pprint("✓ ALL VERIFICATIONS PASSED")
        #     pprint("=" * 60)
        #     pprint(f"\nFinal implementation saved to: {impl_path}")
        #     pprint("\nNext step: Human code review for extra funsies")
        #     break


if __name__ == "__main__":
    main()
