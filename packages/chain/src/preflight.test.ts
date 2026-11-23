import { describe, expect, it } from "vitest";
import { explainFailure } from "./preflight";

describe("explainFailure", () => {
  it("explains an SPL token transfer with too little balance", () => {
    expect(explainFailure({ InstructionError: [2, { Custom: 1 }] }, ["Program log: Instruction: Transfer", "Program log: Error: insufficient funds"], "mUSDC")).toBe("Not enough mUSDC in your wallet for this amount.");
  });
  it("explains missing SOL for fees", () => {
    expect(explainFailure("AccountNotFound", [], "mUSDC")).toMatch(/devnet SOL/);
    expect(explainFailure({ err: "Attempt to debit an account but found no record of a prior credit." })).toMatch(/devnet SOL/);
  });
  it("explains a missing token account", () => {
    expect(explainFailure({ InstructionError: [3, { Custom: 3012 }] }, ["Program log: AnchorError caused by account: user_collateral. Error Code: AccountNotInitialized. Error Number: 3012."], "mUSDC")).toMatch(/doesn't have mUSDC yet|AccountNotInitialized|account/i);
  });
  it("maps pm-AMM program errors to friendly text", () => {
    const logs = ["Program log: AnchorError thrown in programs/pm_amm/src/instructions/swap.rs:120. Error Code: SlippageExceeded. Error Number: 6007. Error Message: Slippage tolerance exceeded."];
    expect(explainFailure({ InstructionError: [4, { Custom: 6007 }] }, logs)).toMatch(/slippage/i);
  });
  it("falls back to the last error log line", () => {
    expect(explainFailure({ InstructionError: [0, "Custom"] }, ["Program log: something failed here"])).toMatch(/something failed here/);
  });
});
