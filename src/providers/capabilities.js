const CAPABILITIES = {
  // Foundational chains have advanced structured data including
  // historical token balances and holder information.
  foundational: {
    token_balances: true,
    token_holders: true,
    transactions: true,
    transfers: true,
    logs: true,
  },
  frontier: {
    token_balances: true,
    token_holders: false,
    transactions: true,
    transfers: true,
    logs: true,
  },
};

export function providerCapabilities(chain){
  const foundationalChains = new Set([
    "eth-mainnet","base-mainnet","bsc-mainnet","polygon-mainnet",
    "arbitrum-mainnet","optimism-mainnet","avalanche-mainnet",
    "gnosis-mainnet"
  ]);
  const solana = chain === "solana-mainnet";
  if (solana) {
    return {
      chain,
      family:"solana",
      token_balances:true,
      token_holders:false,
      transactions:true,
      transfers:true,
      logs:true,
      holder_method:"unsupported_by_current_foundational_endpoint",
    };
  }
  if (foundationalChains.has(chain)) {
    return {chain,family:"evm",...CAPABILITIES.foundational};
  }
  return {chain,family:"evm",...CAPABILITIES.frontier};
}

export function capabilityFor(chain, evidenceType){
  const caps=providerCapabilities(chain);
  return Boolean(caps[evidenceType]);
}
